import * as THREE from 'three';

// Toy-grade material presets: soft clearcoat paint, matte rubber, satin metal.

export function paint(color: string | number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color, roughness: 0.42, metalness: 0.05,
    clearcoat: 0.6, clearcoatRoughness: 0.35,
  });
}

export function plastic(color: string | number, rough = 0.55): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.02 });
}

export function rubber(color: string | number = 0x33363e): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.0 });
}

export function metal(color: string | number = 0x9aa1ae, rough = 0.38): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.85 });
}

export function chrome(color: string | number = 0xd8dce4): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.22, metalness: 0.95 });
}

export function wood(color: string | number = 0xc98f4e): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.0 });
}

export function emissive(color: string | number, intensity = 1.4): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: intensity, roughness: 0.5, metalness: 0,
  });
}

export function glass(color: string | number = 0xaad4e8): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color, roughness: 0.12, metalness: 0, transmission: 0.55, transparent: true,
    opacity: 0.85, ior: 1.4,
  });
}

export function hoseTube(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xe6f4fa, roughness: 0.25, metalness: 0,
    transparent: true, opacity: 0.42, side: THREE.DoubleSide,
  });
}

// simple canvas-texture helper for painted decals / icons / text
export function canvasTexture(
  w: number, h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
