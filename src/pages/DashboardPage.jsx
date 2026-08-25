import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  Layers3,
  LocateFixed,
  Search,
} from "lucide-react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
  Polyline,
} from "react-leaflet";
import L from "leaflet";
import { cameras } from "../data";
import Navbar from "../components/Navbar";

const FLOW_LABELS = ["6AM", "8AM", "10AM", "12PM", "2PM"];

function Recenter({ camera }) {
  const map = useMap();
  useEffect(() => {
    if (camera) {
      map.flyTo([camera.latitude, camera.longitude], 15.5, { duration: 0.6 });
    }
  }, [camera, map]);
  return null;
}

function MapClickReporter({ setCoords }) {
  useMapEvents({
    click(e) {
      setCoords({
        lat: e.latlng.lat.toFixed(5),
        lng: e.latlng.lng.toFixed(5),
      });
    },
  });
  return null;
}

const makeIcon = (color, active) =>
  L.divIcon({
    className: "trace-marker",
    html: `<div style="background:${color};${active ? "outline:4px solid rgba(0,0,0,.12);" : ""}"></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

function TrafficChart({ values }) {
  return (
    <div className="relative h-[170px] pl-8 pt-2">
      <div className="absolute bottom-7 left-0 top-0 flex flex-col justify-between text-[9px] font-bold text-[#636366]">
        <span>1.2K</span><span>1.0K</span><span>0.8K</span><span>0.6K</span><span>0.4K</span>
      </div>
      <div className="relative flex h-full items-end justify-around border-b-2 border-l-2 border-[#1c1c1e] px-3 pb-7">
        {values.map((value, i) => (
          <div key={FLOW_LABELS[i]} className="relative flex h-full w-7 items-end justify-center">
            <div
              className="w-full rounded-t-md bg-[#2b5b75] transition-all duration-500"
              style={{ height: `${value * 75}%` }}
            />
            <span className="absolute -bottom-5 whitespace-nowrap text-[9px] font-bold text-[#636366]">
              {FLOW_LABELS[i]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GisPage({ navigate, openModal, initialArea }) {
  const [selected, setSelected] = useState(cameras.find((c) => c.id === "CAM #402"));
  const [layers, setLayers] = useState({ high: true, medium: true, low: true });
  const [coords, setCoords] = useState(null);

  const congestionLines = useMemo(() => {
    const lines = [];
    if (layers.high) {
      lines.push({
        color: "#e64638",
        positions: [
          [17.516, 78.426],
          [17.5, 78.414],
          [17.489, 78.4012],
          [17.475, 78.405],
        ],
      });
    }
    if (layers.medium) {
      lines.push({
        color: "#f4be25",
        positions: [
          [17.489, 78.4012],
          [17.486, 78.415],
          [17.482, 78.438],
          [17.480, 78.46],
        ],
      });
    }
    if (layers.low) {
      lines.push({
        color: "#52b788",
        positions: [
          [17.486, 78.37],
          [17.488, 78.39],
          [17.489, 78.401],
        ],
      });
    }
    return lines;
  }, [layers]);

  useEffect(() => {
    if (initialArea) {
      const nearest = cameras.reduce((best, camera) => {
        const dBest =
          Math.abs(best.latitude - initialArea.position[0]) +
          Math.abs(best.longitude - initialArea.position[1]);
        const dCam =
          Math.abs(camera.latitude - initialArea.position[0]) +
          Math.abs(camera.longitude - initialArea.position[1]);
        return dCam < dBest ? camera : best;
      }, cameras[1]);
      setSelected(nearest);
    }
  }, [initialArea]);

  return (
    <>
      <Navbar page="gis" navigate={navigate} openModal={openModal} />

      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">
            {initialArea?.name || "Kukatpally"} - GIS Map
          </h2>
          <p className="mt-1 text-xs text-[#636366]">
            Live spatial traffic intelligence · click a camera for synchronized analytics
          </p>
        </div>

        <button
          onClick={() => navigate("home")}
          className="rounded-lg border border-black/10 bg-white/85 px-3 py-2 text-xs font-bold shadow-sm hover:bg-white"
        >
          Back to Dashboard
        </button>
      </div>

      <div className="grid min-h-[540px] grid-cols-[minmax(0,1fr)_320px] gap-5 max-[950px]:grid-cols-1">
        <section className="flex min-h-[540px] flex-col rounded-[18px] border border-white/65 bg-[rgba(255,255,255,0.8)] p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between rounded-[10px] border border-black/[0.08] bg-white/70 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Layers3 size={17} />
              <span className="text-sm font-bold">Traffic & congestion spatial analysis</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-semibold text-[#636366]">
              <Activity size={13} />
              Live map
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#34c759]" />
            </div>
          </div>

          <div className="relative flex-1 overflow-hidden rounded-xl border border-black/10">
            <MapContainer
              center={[17.49, 78.405]}
              zoom={14}
              scrollWheelZoom
              className="h-full min-h-[430px] w-full"
            >
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {congestionLines.map((line, i) => (
                <Polyline
                  key={i}
                  positions={line.positions}
                  pathOptions={{ color: line.color, weight: 8, opacity: 0.82 }}
                />
              ))}

              {cameras.map((camera) => (
                <Marker
                  key={camera.id}
                  position={[camera.latitude, camera.longitude]}
                  icon={makeIcon(camera.color, selected.id === camera.id)}
                  eventHandlers={{
                    click: () => setSelected(camera),
                  }}
                >
                  <Popup className="trace-popup">
                    <div className="min-w-[180px]">
                      <div className="mb-2 flex items-center justify-between">
                        <strong>{camera.id}</strong>
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: camera.color }} />
                      </div>
                      <div className="space-y-1 text-[11px]">
                        <div className="flex justify-between"><span>Latitude</span><strong>{camera.latitude}</strong></div>
                        <div className="flex justify-between"><span>Longitude</span><strong>{camera.longitude}</strong></div>
                        <div className="flex justify-between"><span>Speed</span><strong>{camera.speed}</strong></div>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              ))}

              <CircleMarker
                center={[17.49, 78.405]}
                radius={22}
                pathOptions={{
                  color: "#ff3b30",
                  fillColor: "#ff3b30",
                  fillOpacity: 0.08,
                  weight: 2,
                }}
              />

              <Recenter camera={selected} />
              <MapClickReporter setCoords={setCoords} />
            </MapContainer>

            <div className="pointer-events-none absolute right-4 top-4 z-[500] max-w-[205px] rounded-xl border border-black/10 bg-white/95 p-3 text-[10px] font-extrabold uppercase leading-[1.35] shadow-xl backdrop-blur">
              Click a camera node to synchronize the analytics panel.
            </div>

            <div className="absolute bottom-4 left-4 z-[500] flex items-center gap-2 rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-[10px] font-semibold shadow">
              <LocateFixed size={13} />
              {coords ? `${coords.lat}, ${coords.lng}` : "Click map for coordinates"}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-5 rounded-[10px] border border-black/[0.08] bg-white/85 px-4 py-2 text-xs font-bold">
            <span className="text-sm font-extrabold">Layers</span>
            {[
              ["high", "High", "#e64638"],
              ["medium", "Med", "#f4be25"],
              ["low", "Low", "#52b788"],
            ].map(([key, label, color]) => (
              <button
                key={key}
                onClick={() => setLayers((s) => ({ ...s, [key]: !s[key] }))}
                className="flex items-center gap-1.5"
              >
                <span
                  className={`h-3.5 w-3.5 rounded-[3px] border border-black/20 ${layers[key] ? "opacity-100" : "opacity-30"}`}
                  style={{ backgroundColor: color }}
                />
                {label}
              </button>
            ))}
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-[10px] border border-black/10 bg-[#d4dadd] px-3.5 py-2 text-xs font-bold shadow-inner">
            <span>Selected camera</span>
            <div className="flex items-center gap-1.5">{selected.id}<ChevronDown size={14} /></div>
          </div>

          <section className="rounded-[18px] border border-white/65 bg-[rgba(255,255,255,0.8)] p-[18px] shadow-sm">
            <h3 className="text-base font-extrabold">Analytics</h3>
            <div className="mt-3 space-y-2.5 text-sm">
              <div><span className="font-semibold text-[#636366]">Avg speed: </span><b>{selected.speed}</b></div>
              <div><span className="font-semibold text-[#636366]">Route density: </span><b>{selected.density}</b></div>
              <div>
                <div className="font-extrabold">Trend:</div>
                <div className="font-bold">{selected.trend}</div>
              </div>
            </div>
          </section>

          <section className="flex-1 rounded-[18px] border border-white/65 bg-[rgba(255,255,255,0.8)] p-[18px] shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-[13px] font-bold">Traffic flow trends</h4>
              <span className="text-[10px] font-semibold text-[#636366]">vehicles / hr</span>
            </div>
            <TrafficChart values={selected.flow} />
          </section>

          <button
            onClick={() =>
              openModal(
                "Trajectory Search",
                `Vehicle trajectory search is connected to ${selected.id}. Enter a plate number here to launch the spatial-temporal trace workflow.`
              )
            }
            className="flex items-center justify-center gap-2 rounded-xl border border-black/10 bg-white/80 px-4 py-2.5 text-xs font-bold hover:bg-white"
          >
            <Search size={14} />
            Search vehicle trajectory
          </button>
        </aside>
      </div>
    </>
  );
}
