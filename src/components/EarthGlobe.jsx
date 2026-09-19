import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Stars, useTexture } from "@react-three/drei";
import * as THREE from "three";

const DEG = Math.PI / 180;
const AXIAL_TILT = 23.44 * DEG;
const EARTH_MAP = "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg";
const EARTH_NORMAL = "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_normal_2048.jpg";
const EARTH_SPECULAR = "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_specular_2048.jpg";
const EARTH_CLOUDS = "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_clouds_1024.png";

function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

// Low-cost solar ephemeris. It keeps the terminator, Indian daylight and axial tilt
// tied to UTC, without a perpetual decorative rotation loop.
function getCelestialState(date) {
  const days = julianDay(date) - 2451545.0;
  const meanLongitude = (280.46 + 0.9856474 * days) % 360;
  const meanAnomaly = (357.528 + 0.9856003 * days) % 360;
  const eclipticLongitude = (meanLongitude + 1.915 * Math.sin(meanAnomaly * DEG) + 0.02 * Math.sin(2 * meanAnomaly * DEG)) * DEG;
  const obliquity = (23.439 - 0.0000004 * days) * DEG;
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const gmst = ((280.46061837 + 360.98564736629 * days) % 360 + 360) % 360;
  const solarVector = new THREE.Vector3(
    Math.cos(declination) * Math.cos(rightAscension),
    Math.sin(declination),
    Math.cos(declination) * Math.sin(rightAscension)
  );

  return {
    earthRotation: gmst * DEG,
    sunPosition: solarVector.multiplyScalar(16),
    utc: new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "UTC",
      hour12: false,
    }).format(date),
  };
}

const atmosphereVertex = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const atmosphereFragment = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    float fresnel = 1.0 - max(dot(normalize(-vPosition), vNormal), 0.0);
    fresnel = pow(fresnel, 3.2);
    vec3 blue = vec3(0.05, 0.42, 1.0);
    gl_FragColor = vec4(blue, fresnel * 0.68);
  }
`;

function Atmosphere() {
  return (
    <mesh scale={1.075} renderOrder={2}>
      <sphereGeometry args={[1, 64, 48]} />
      <shaderMaterial
        vertexShader={atmosphereVertex}
        fragmentShader={atmosphereFragment}
        transparent
        side={THREE.BackSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

function Planet({ rotation }) {
  const [map, normalMap, specularMap, cloudMap] = useTexture([
    EARTH_MAP,
    EARTH_NORMAL,
    EARTH_SPECULAR,
    EARTH_CLOUDS,
  ]);

  useMemo(() => {
    [map, normalMap, specularMap, cloudMap].forEach((texture) => {
      texture.colorSpace = texture === map ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = 4;
    });
  }, [map, normalMap, specularMap, cloudMap]);

  return (
    <group rotation={[0, 0, -AXIAL_TILT]}>
      <group rotation={[0, rotation, 0]}>
        <mesh>
          <sphereGeometry args={[1, 96, 64]} />
          <meshPhongMaterial
            map={map}
            normalMap={normalMap}
            normalScale={new THREE.Vector2(0.6, 0.6)}
            specularMap={specularMap}
            specular={new THREE.Color("#7dbbff")}
            shininess={10}
          />
        </mesh>
        <mesh scale={1.012}>
          <sphereGeometry args={[1, 80, 56]} />
          <meshPhongMaterial map={cloudMap} transparent opacity={0.32} depthWrite={false} />
        </mesh>
      </group>
      <Atmosphere />
    </group>
  );
}

function Sun({ position }) {
  return (
    <group position={position}>
      <pointLight intensity={2.2} color="#fff4cf" distance={55} decay={1.25} />
      <mesh>
        <sphereGeometry args={[0.3, 24, 24]} />
        <meshBasicMaterial color="#fff6c7" toneMapped={false} />
      </mesh>
      <mesh scale={2.2}>
        <sphereGeometry args={[0.3, 24, 24]} />
        <meshBasicMaterial color="#ffb84d" transparent opacity={0.08} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Scene({ celestial }) {
  const { invalidate } = useThree();

  useEffect(() => invalidate(), [celestial, invalidate]);

  return (
    <>
      <ambientLight intensity={0.035} color="#7ca7ff" />
      <directionalLight position={celestial.sunPosition} intensity={2.45} color="#fff4db" />
      <Stars radius={180} depth={70} count={1800} factor={3} saturation={0.08} fade speed={0} />
      <Planet rotation={celestial.earthRotation} />
      <Sun position={celestial.sunPosition} />
      <OrbitControls
        enableZoom={false}
        enablePan={false}
        enableDamping={false}
        minPolarAngle={Math.PI * 0.39}
        maxPolarAngle={Math.PI * 0.61}
        rotateSpeed={0.38}
      />
    </>
  );
}

function GlobeFallback() {
  return <div className="globe-fallback" aria-label="Loading Earth visualization" />;
}

export default function EarthGlobe({ style, className = "" }) {
  const [now, setNow] = useState(() => new Date());
  const celestial = useMemo(() => getCelestialState(now), [now]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={`earth-globe ${className}`} style={style}>
      <Suspense fallback={<GlobeFallback />}>
        <Canvas
          frameloop="demand"
          camera={{ position: [0, 0.12, 3.15], fov: 39, near: 0.1, far: 250 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          onCreated={({ gl }) => {
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.15;
          }}
        >
          <Scene celestial={celestial} />
        </Canvas>
      </Suspense>
      <div className="globe-readout" aria-hidden="true">
        <span className="live-dot" /> UTC {celestial.utc}
      </div>
      <div className="globe-drag-hint" aria-hidden="true">Drag to inspect orbital view</div>
    </div>
  );
}
