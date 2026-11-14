// Derives web-ready copies of the opening-screen assets. Originals in assets/ are never modified.
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import sharp from 'sharp';

const MODELS = [
  ['assets/models/desert-bike/desert-bike.glb', 'public/models/desert-bike.glb'],
  ['assets/models/mascot/rider.glb', 'public/models/rider.glb'],
];
const POSTER = ['assets/desert/opening/first-frame.png', 'public/opening/first-frame.webp'];

const size = (file) => `${(statSync(file).size / 1024 / 1024).toFixed(2)} MB`;

mkdirSync('public/models', { recursive: true });
mkdirSync('public/opening', { recursive: true });

for (const [input, output] of MODELS) {
  execFileSync(
    'node_modules/.bin/gltf-transform',
    ['optimize', input, output, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '2048', '--simplify', 'false'],
    { stdio: 'inherit' },
  );
  console.log(`${input} (${size(input)}) -> ${output} (${size(output)})`);
}

await sharp(POSTER[0]).webp({ quality: 86 }).toFile(POSTER[1]);
console.log(`${POSTER[0]} (${size(POSTER[0])}) -> ${POSTER[1]} (${size(POSTER[1])})`);
