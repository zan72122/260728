// Downloads CC0 models from Kenney's "Car Kit" (https://kenney.nl/assets/car-kit)
// via a verbatim GitHub mirror of the kit. License: Creative Commons Zero (CC0).
// The fetched .glb files are committed to the repo so builds stay self-contained.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://raw.githubusercontent.com/Arslan12216775/kenney_car-kit/master';
const OUT = 'public/assets/kenney';
mkdirSync(OUT, { recursive: true });

const FILES = [
  'Models/GLB format/hatchback-sports.glb',
  'Models/GLB format/van.glb',
  'Models/GLB format/truck.glb',
  'Models/GLB format/sedan.glb',
  'Models/GLB format/wheel-default.glb',
  'Models/GLB format/wheel-dark.glb',
  'Models/GLB format/debris-bolt.glb',
  'Models/GLB format/debris-nut.glb',
  'Models/GLB format/debris-drivetrain.glb',
  'Models/GLB format/debris-drivetrain-axle.glb',
  'Models/GLB format/debris-plate-a.glb',
  'Models/GLB format/debris-plate-small-a.glb',
  'Models/GLB format/debris-tire.glb',
  'Models/GLB format/debris-bumper.glb',
  'Models/GLB format/cone.glb',
  'Models/GLB format/box.glb',
  'License.txt',
];

for (const f of FILES) {
  const url = `${BASE}/${f.split('/').map(encodeURIComponent).join('/')}`;
  const name = f.split('/').pop();
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`FAILED ${res.status} ${name}`);
    process.exitCode = 1;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(OUT, name), buf);
  console.log(`ok ${name} (${buf.length} bytes)`);
}
