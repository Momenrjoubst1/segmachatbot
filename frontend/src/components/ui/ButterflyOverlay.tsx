import { Suspense, useRef, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations, useTexture } from "@react-three/drei";
import * as THREE from "three";

/* ─────────────────────────────────────────────────
   Diagonal flight path (seconds, cycle = 12s)
   The bee enters from the bottom-right corner,
   crosses the screen diagonally and exits at the
   top-left corner. It then waits off-screen for a
   few seconds (8s–12s) before looping back to the
   start and repeating the same path.
───────────────────────────────────────────────── */
const CYCLE = 12; // total seconds per full cycle

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// [x, y, z] in camera space. Diagonal from bottom-right
// to top-left. As the bee approaches the building (middle
// of the image) it shrinks as if passing at a distance,
// then grows back and continues to the top-left corner.
const PATH: { t: number; pos: [number, number, number]; rotY: number }[] = [
  { t: 0.0, pos: [ 5.0, -3.5, 0 ], rotY:  0.9 },  // off-screen bottom-right
  { t: 1.5, pos: [ 3.1, -2.0, 0 ], rotY:  0.9 },
  { t: 2.6, pos: [ 1.7, -1.0, 0 ], rotY:  0.9 },
  { t: 3.4, pos: [ 0.8, -0.4, 0 ], rotY:  0.9 },  // approaching the building
  { t: 4.0, pos: [ 0.0,  0.0, 0 ], rotY:  0.9 },  // beside the building
  { t: 4.6, pos: [-0.8,  0.4, 0 ], rotY:  0.9 },  // past it
  { t: 5.6, pos: [-1.8,  1.0, 0 ], rotY:  0.9 },
  { t: 6.5, pos: [-3.1,  2.0, 0 ], rotY:  0.9 },
  { t: 8.0, pos: [-5.0,  3.5, 0 ], rotY:  0.9 },  // off-screen top-left
];

// Shrink window (seconds): the bee scales down near the
// building but never disappears or enters it.
const SHRINK_IN_T   = 3.4;  // start shrinking
const SHRINK_PEAK_T = 4.0;  // smallest
const SHRINK_OUT_T  = 4.6;  // back to normal
const SHRINK_MIN    = 0.35; // scale multiplier at peak

function samplePath(t: number) {
  const c = ((t % CYCLE) + CYCLE) % CYCLE;
  for (let i = 0; i < PATH.length - 1; i++) {
    const a = PATH[i], b = PATH[i + 1];
    if (c >= a.t && c <= b.t) {
      const e = easeInOut((c - a.t) / (b.t - a.t));
      return {
        pos: PATH[i].pos.map((v, j) => lerp(v, b.pos[j], e)) as [number, number, number],
        rotY: lerp(a.rotY, b.rotY, e),
        progress: c,
      };
    }
  }
  const last = PATH[PATH.length - 1];
  return { pos: last.pos, rotY: last.rotY, progress: c };
}

/* ─────────────────────────────────────────────────
   Bee 3D Model with Original High-Res Textures
───────────────────────────────────────────────── */
type Phase = "hover";

function BeeModel() {
  const group = useRef<THREE.Group>(null!);
  const lastProgressRef = useRef(0);
  const elapsedRef = useRef(0);
  const { scene, animations } = useGLTF("/bee.glb");
  const { actions, mixer } = useAnimations(animations, group);
  const phaseRef = useRef<Phase>("hover");

  // Load color & normal maps
  const [colorMap, normalMap] = useTexture([
    "/gltf_embedded_0.png",
    "/gltf_embedded_2.png",
  ]);

  // Configure textures & apply to all meshes
  useEffect(() => {
    if (colorMap) {
      colorMap.flipY = false;
      colorMap.colorSpace = THREE.SRGBColorSpace;
      colorMap.needsUpdate = true;
    }
    if (normalMap) {
      normalMap.flipY = false;
      normalMap.needsUpdate = true;
    }

    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.material = new THREE.MeshStandardMaterial({
          map: colorMap,
          normalMap: normalMap,
          roughness: 0.35,
          metalness: 0.15,
          transparent: true,
          side: THREE.DoubleSide,
        });
      }
    });
  }, [scene, colorMap, normalMap]);

  /** Fade-switch animation, no cut */
  const switchTo = (next: Phase) => {
    if (phaseRef.current === next) return;
    const prev = phaseRef.current;
    phaseRef.current = next;
    actions[prev]?.fadeOut(0.4);
    const act = actions[next];
    if (act) {
      act.reset().fadeIn(0.4).play();
    }
  };

  // Start with hover immediately
  useEffect(() => {
    const act = actions["hover"];
    if (act) { act.play(); }
  }, [actions]);

  useFrame((_, delta) => {
    mixer.update(delta);
    elapsedRef.current += delta;
    const t = elapsedRef.current;
    const { pos, rotY, progress } = samplePath(t);

    // When the cycle wraps back to the start, snap the bee
    // instantly to the entrance (off-screen) so it looks like
    // a brand-new bee starting the scene, not one flying back
    // from the exit.
    if (progress < lastProgressRef.current) {
      group.current.position.set(...PATH[0].pos);
      group.current.rotation.y = PATH[0].rotY;
    }
    lastProgressRef.current = progress;

    // Smooth position
    group.current.position.lerp(new THREE.Vector3(...pos), 0.07);
    group.current.rotation.y = THREE.MathUtils.lerp(
      group.current.rotation.y, rotY, 0.08
    );

    // Constant gentle vertical bob
    group.current.position.y += Math.sin(t * 9) * 0.03;

    // Shrink near the building, grow back after passing it
    let scaleFactor = 1;
    if (progress >= SHRINK_IN_T && progress < SHRINK_PEAK_T) {
      scaleFactor = 1 - (1 - SHRINK_MIN) * (progress - SHRINK_IN_T) / (SHRINK_PEAK_T - SHRINK_IN_T);
    } else if (progress >= SHRINK_PEAK_T && progress < SHRINK_OUT_T) {
      scaleFactor = SHRINK_MIN + (1 - SHRINK_MIN) * (progress - SHRINK_PEAK_T) / (SHRINK_OUT_T - SHRINK_PEAK_T);
    }
    group.current.scale.setScalar(0.008 * scaleFactor);

    // Always fully visible
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mat = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat) mat.opacity = 1;
      }
    });

    switchTo("hover");
  });

  return (
    <group ref={group} scale={0.008} position={[5.0, -3.5, 0]}>
      <primitive object={scene} />
    </group>
  );
}

/* ─────────────────────────────────────────────────
   Exported overlay – transparent Canvas over image
───────────────────────────────────────────────── */
export function ButterflyOverlay() {
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 5], fov: 50 }}
        gl={{ alpha: true, antialias: true }}
        style={{ background: "transparent", pointerEvents: "none" }}
      >
        <ambientLight intensity={1.8} />
        <directionalLight position={[4, 8, 4]}  intensity={2.2} />
        <directionalLight position={[-3, 2, -2]} intensity={1.0} color="#fff1cc" />
        <directionalLight position={[0, -2, 2]} intensity={0.6} color="#ffffff" />

        <Suspense fallback={null}>
          <BeeModel />
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload("/bee.glb");
useTexture.preload("/gltf_embedded_0.png");
useTexture.preload("/gltf_embedded_2.png");
