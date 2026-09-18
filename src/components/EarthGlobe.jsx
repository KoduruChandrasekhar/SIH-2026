import { useRef, useMemo } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { Stars, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

/* ──────────────────────────────────────────
   Constants
   ────────────────────────────────────────── */
const DEG2RAD = Math.PI / 180;
const AXIAL_TILT = 23.44 * DEG2RAD;

// NASA Blue Marble texture (public domain, 2K)
const EARTH_TEXTURE_URL =
  "https://unpkg.com/three-globe@2.35.0/example/img/earth-blue-marble.jpg";
const EARTH_BUMP_URL =
  "https://unpkg.com/three-globe@2.35.0/example/img/earth-topology.png";

/* ──────────────────────────────────────────
   Sun position from current time (simplified)
   ────────────────────────────────────────── */
function getSunDirection() {
  const now = new Date();
  const hours = now.getUTCHours() + now.getUTCMinutes() / 60;
  // Sun is overhead at UTC noon → angle = 0 at 12:00 UTC
  const angle = ((hours - 12) / 24) * Math.PI * 2;
  return new THREE.Vector3(
    Math.cos(angle) * 5,
    1.5,
    Math.sin(angle) * 5
  );
}

/* ──────────────────────────────────────────
   Atmosphere Glow (Fresnel rim shader)
   ────────────────────────────────────────── */
const atmosphereVertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const atmosphereFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vec3 viewDir = normalize(-vPosition);
    float rim = 1.0 - max(dot(viewDir, vNormal), 0.0);
    rim = pow(rim, 3.0);
    vec3 color = mix(vec3(0.15, 0.45, 1.0), vec3(0.3, 0.7, 1.0), rim);
    gl_FragColor = vec4(color, rim * 0.6);
  }
`;

function AtmosphereGlow() {
  return (
    <mesh scale={[1.06, 1.06, 1.06]}>
      <sphereGeometry args={[1, 64, 64]} />
      <shaderMaterial
        vertexShader={atmosphereVertexShader}
        fragmentShader={atmosphereFragmentShader}
        transparent
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  );
}

/* ──────────────────────────────────────────
   Earth Sphere
   ────────────────────────────────────────── */
function Earth() {
  const earthRef = useRef();
  const texture = useLoader(THREE.TextureLoader, EARTH_TEXTURE_URL);
  const bumpMap = useLoader(THREE.TextureLoader, EARTH_BUMP_URL);

  // Slow auto-rotation
  useFrame((_, delta) => {
    if (earthRef.current) {
      earthRef.current.rotation.y += delta * 0.05;
    }
  });

  return (
    <group rotation={[0, 0, -AXIAL_TILT]}>
      <mesh ref={earthRef}>
        <sphereGeometry args={[1, 64, 64]} />
        <meshStandardMaterial
          map={texture}
          bumpMap={bumpMap}
          bumpScale={0.03}
          metalness={0.1}
          roughness={0.7}
        />
      </mesh>
      <AtmosphereGlow />
    </group>
  );
}

/* ──────────────────────────────────────────
   Scene Setup
   ────────────────────────────────────────── */
function Scene() {
  const sunDir = useMemo(() => getSunDirection(), []);

  return (
    <>
      <ambientLight intensity={0.12} color="#8ab4f8" />
      <directionalLight
        position={sunDir}
        intensity={1.8}
        color="#ffffff"
        castShadow={false}
      />
      <pointLight position={[-3, 1, -2]} intensity={0.3} color="#3b82f6" />
      <Stars
        radius={200}
        depth={80}
        count={4000}
        factor={4}
        saturation={0.1}
        fade
        speed={0.5}
      />
      <Earth />
      <OrbitControls
        enableZoom={false}
        enablePan={false}
        minPolarAngle={Math.PI / 3}
        maxPolarAngle={(Math.PI * 2) / 3}
        autoRotate
        autoRotateSpeed={0.15}
        rotateSpeed={0.4}
        dampingFactor={0.08}
        enableDamping
      />
    </>
  );
}

/* ──────────────────────────────────────────
   Exported Globe Component
   ────────────────────────────────────────── */
export default function EarthGlobe({ style, className }) {
  return (
    <div
      className={className}
      style={{
        width: "100%",
        height: "100%",
        position: "absolute",
        inset: 0,
        ...style,
      }}
    >
      <Canvas
        camera={{
          position: [0, 0.4, 2.8],
          fov: 45,
          near: 0.1,
          far: 1000,
        }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        }}
        dpr={[1, 2]}
        style={{ background: "transparent" }}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
