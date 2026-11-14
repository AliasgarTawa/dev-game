"""One explicit submission; subsequent invocations only poll/download that task."""
from pathlib import Path
import base64, json, re, shlex, sys, urllib.request, urllib.error
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
key = None
for line in (PROJECT / '.env').read_text().splitlines():
    match = re.match(r'^\s*(?:export\s+)?MESHY_API_KEY\s*=\s*(.*)$', line)
    if match:
        parts = shlex.split(match.group(1), comments=True)
        key = parts[0] if parts else ''
if not key:
    raise SystemExit('MESHY_API_KEY is empty or missing')

def api(path, data=None):
    req = urllib.request.Request('https://api.meshy.ai/openapi/v1/' + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Never log request headers, credentials, or image data.
        message = error.read().decode(errors='replace').replace(key, '[REDACTED]')
        print(json.dumps({'http_status': error.code, 'message': message[:1200]}))
        raise SystemExit(1)

mode = sys.argv[1]
task_file = ROOT / 'task.json'
if mode == 'submit':
    if task_file.exists() or (ROOT / 'submission-started.json').exists():
        raise SystemExit('Submission already attempted. Inspect saved task; do not duplicate.')
    settings = dict(ai_model='meshy-7.1', geometry_resolution='standard',
        should_texture=True, texture_resolution='4k', enable_pbr=True,
        should_remesh=True, topology='triangle', target_polycount=30000,
        save_pre_remeshed_model=True, image_enhancement=False,
        target_formats=['glb', 'fbx'], multi_view_thumbnails=True)
    (ROOT / 'settings.json').write_text(json.dumps(settings, indent=2))
    (ROOT / 'balance-before.json').write_text(json.dumps(api('balance'), indent=2))
    payload = dict(settings, image_url='data:image/png;base64,' +
        base64.b64encode((ROOT / 'bike-reference.png').read_bytes()).decode())
    (ROOT / 'submission-started.json').write_text(json.dumps({'utc': datetime.now(timezone.utc).isoformat(), 'estimated_credits': 30}))
    task = api('image-to-3d', payload)
    task_file.write_text(json.dumps(task, indent=2))
    print(json.dumps(task))
elif mode in ('status', 'download'):
    task_id = json.loads(task_file.read_text())['result']
    task = api('image-to-3d/' + task_id)
    (ROOT / 'task-status.json').write_text(json.dumps(task, indent=2))
    print(json.dumps({k:task[k] for k in ('id','status','progress','started_at','finished_at','task_error') if k in task}))
    if mode == 'download' and task.get('status') == 'SUCCEEDED':
        items = [(name, url) for name, url in task.get('model_urls', {}).items() if url]
        for name, url in items:
            suffix = 'glb' if name == 'pre_remeshed_glb' else name
            dest = ROOT / ('desert-bike-highpoly.glb' if name == 'pre_remeshed_glb' else 'desert-bike.' + suffix)
            if not dest.exists():
                urllib.request.urlretrieve(url, dest)
            print(json.dumps({'saved':dest.name,'bytes':dest.stat().st_size}))
        for name in ('thumbnail_url', 'alpha_thumbnail_url'):
            if task.get(name):
                dest = ROOT / (name.replace('_url', '') + '.png')
                urllib.request.urlretrieve(task[name], dest)
                print(json.dumps({'saved':dest.name}))
        thumbs = task.get('thumbnail_urls', {})
        if isinstance(thumbs, dict):
            for name, url in thumbs.items():
                if isinstance(url,str) and url.startswith('https://'):
                    dest = ROOT / ('preview-' + re.sub(r'[^a-zA-Z0-9_-]', '', name) + '.png')
                    urllib.request.urlretrieve(url, dest)
                    print(json.dumps({'saved':dest.name}))
        (ROOT / 'balance-after.json').write_text(json.dumps(api('balance'), indent=2))
