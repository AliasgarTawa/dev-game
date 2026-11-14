"""Rebuild Roots delivery audio and its measurement manifest. Requires ffmpeg and numpy.

MP3 generations remain untouched. WAV masters are derived, not higher-fidelity
recordings. All processing is local; this script never calls a paid provider.
"""
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "assets/audio/roots"
PUBLIC = ROOT / "public/audio/roots"
RATE = 48000
REQUESTS = json.loads((SOURCES / "generation.json").read_text())


def decode(path, channels, highpass=60, lowpass=9000):
    data = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(path), "-ac", str(channels),
        "-ar", str(RATE), "-af", f"highpass=f={highpass},lowpass=f={lowpass}",
        "-f", "f32le", "pipe:1",
    ])
    return np.frombuffer(data, dtype="<f4").reshape(-1, channels).copy()


def measure(data):
    log = subprocess.run([
        "ffmpeg", "-hide_banner", "-f", "f32le", "-ar", str(RATE),
        "-ac", str(data.shape[1]), "-i", "pipe:0",
        "-af", "loudnorm=I=-20:TP=-4:LRA=8:print_format=json", "-f", "null", "-",
    ], input=data.astype("<f4").tobytes(), capture_output=True, check=True).stderr.decode()
    values = json.loads(log[log.rindex("{"):log.rindex("}") + 1])
    return float(values["input_i"]), float(values["input_tp"])


def normalize(data, target, peak=-5):
    loudness, true_peak = measure(data)
    gain = min(target - loudness, peak - true_peak)
    return data * 10 ** (gain / 20)


def overlap(a, b, seconds=0.15):
    count = round(seconds * RATE)
    fade = (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, count)))[:, None]
    return np.concatenate((a[:-count], a[-count:] * (1 - fade) + b[:count] * fade, b[count:]))


def loop_join(data, seconds=0.15):
    count = round(seconds * RATE)
    # Rotate the join into the file. Its new endpoints are adjacent original samples.
    fade = (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, count)))[:, None]
    return np.concatenate((data[count:-count], data[-count:] * (1 - fade) + data[:count] * fade))


def tempo_estimate(data):
    """Onset autocorrelation diagnostic, not a certification of tempo or beat alignment."""
    mono = data.mean(axis=1)[::4]
    window, hop = 1024, 128
    frames = np.lib.stride_tricks.sliding_window_view(mono, window)[::hop]
    spectrum = np.abs(np.fft.rfft(frames * np.hanning(window), axis=1))
    flux = np.maximum(np.diff(np.log1p(spectrum), axis=0), 0).sum(axis=1)
    flux -= flux.mean()
    correlation = np.correlate(flux, flux, mode="full")[len(flux) - 1:]
    frames_per_second = RATE / 4 / hop
    lags = np.arange(int(frames_per_second * 60 / 140), int(frames_per_second * 60 / 65))
    lag = lags[np.argmax(correlation[lags])]
    return round(frames_per_second * 60 / lag, 2)


def deliver(name, data, sources, looping, target, music=False, compressed=False):
    data = normalize(data, target)
    assert np.isfinite(data).all() and np.max(np.abs(data)) < 1
    master = SOURCES / f"{name}.master.wav"
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE),
        "-ac", str(data.shape[1]), "-i", "pipe:0", "-c:a", "pcm_s24le", str(master),
    ], input=data.astype("<f4").tobytes(), check=True)
    compressed = compressed or music
    output = PUBLIC / f"{name}.{'mp3' if compressed else 'wav'}"
    codec = ["-c:a", "libmp3lame", "-b:a", "192k", "-write_xing", "1"] if compressed else ["-c:a", "pcm_s16le"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(master), *codec, str(output)], check=True)
    decoded = decode(output, data.shape[1], 1, 23000)
    loudness, peak = measure(decoded)
    silent_windows = [
        np.max(np.abs(decoded[i:i + RATE // 20])) < 0.00001
        for i in range(0, len(decoded) - RATE // 20, RATE // 20)
    ]
    result = {
        "name": name, "sources": sources, "master": master.name,
        "delivery": str(output.relative_to(ROOT)),
        "durationSeconds": round(len(decoded) / RATE, 6), "sampleRate": RATE,
        "channels": data.shape[1], "loop": looping,
        "loopStartSeconds": 0 if looping else None,
        "loopEndSeconds": round(len(data) / RATE, 6) if looping else None,
        "lufs": loudness, "truePeakDbtp": peak,
        "clippedSamples": int(np.count_nonzero(np.abs(decoded) >= 1)),
        "silent50msWindows": int(sum(silent_windows)),
        "seamStep": float(np.max(np.abs(decoded[-1] - decoded[0]))) if looping else None,
        "bytes": output.stat().st_size,
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
    }
    if music:
        result["estimatedBpm"] = tempo_estimate(decoded)
        result["tonalCentreVerified"] = False
        result["beatGridVerified"] = False
    print(name, result["durationSeconds"], "s", loudness, "LUFS", peak, "dBTP")
    return result


def main():
    PUBLIC.mkdir(parents=True, exist_ok=True)
    assets = []
    for request in REQUESTS["music"]:
        data = decode(SOURCES / request["source"], 2, 30, 18000)
        data = loop_join(data[1200:-1200], 0.2)
        assets.append(deliver(request["name"], data, [request["source"]], True, -20, music=True))

    for style in ["day", "night"]:
        requests = [r for r in REQUESTS["effects"] if r["name"].startswith(f"forest-{style}-")]
        clips = [normalize(decode(SOURCES / r["source"], 2)[1200:-1200], -26) for r in requests]
        data = clips[0]
        for clip in clips[1:]:
            data = overlap(data, clip)
        # Four five-second generations, with short joins and a small pitch-preserving
        # stretch, form a 20-second bed. The final wrap removes 40 ms of overlap.
        tempo = (len(data) / RATE) / 20.04
        stretched = subprocess.run([
            "ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(RATE), "-ac", "2",
            "-i", "pipe:0", "-af", f"atempo={tempo},apad=whole_dur=20.04,atrim=duration=20.04",
            "-f", "f32le", "pipe:1",
        ], input=data.astype("<f4").tobytes(), capture_output=True, check=True).stdout
        data = loop_join(np.frombuffer(stretched, dtype="<f4").reshape(-1, 2), 0.04)
        assets.append(deliver(f"forest-{style}", data, [r["source"] for r in requests], True, -26, compressed=True))

    for request in REQUESTS["effects"]:
        if request["name"].startswith("forest-"):
            continue
        data = decode(SOURCES / request["source"], 1)
        if request["loop"]:
            data = loop_join(data[1200:-1200])
        else:
            # Gentle boundary fades protect against an abruptly generated head/tail.
            count = min(round(RATE * 0.02), len(data) // 4)
            data[:count] *= np.linspace(0, 1, count)[:, None]
            data[-count:] *= np.linspace(1, 0, count)[:, None]
        target = -24 if request["name"].startswith("tires") else -22
        if request["name"] == "brake-soft":
            target = -27
        assets.append(deliver(request["name"], data, [request["source"]], request["loop"], target))

    source_metadata = []
    for request in REQUESTS["music"] + REQUESTS["effects"]:
        path = SOURCES / request["source"]
        probe = json.loads(subprocess.check_output([
            "ffprobe", "-v", "error", "-show_entries", "stream=sample_rate,channels:format=duration",
            "-of", "json", str(path),
        ]))
        source_metadata.append({"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), **probe})
    manifest = {
        "schemaVersion": 1, "generationRecord": "generation.json",
        "sourceFidelity": "Original MP3 exports retained. 48 kHz WAV masters are processing derivatives, not enhanced recordings.",
        "musicTransitionMode": "ambience-bridge",
        "musicTransitionReason": "Companion arrangements are conditioned on the same source, but exact beat grids and tonal compatibility have not been certified. Fade through ambience instead of overlaying unverified beats.",
        "observedCreditCost": REQUESTS["observedCreditCost"],
        "humanListeningReview": "pending",
        "sources": source_metadata, "assets": assets,
    }
    (SOURCES / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
