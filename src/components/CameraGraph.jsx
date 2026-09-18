import { CAMERA_NETWORK_NODES, CAMERA_NETWORK_EDGES } from "../demoData";

export default function CameraGraph({ activeRoute, currentCamera, isAnimating }) {
  // Simple layout scaling for the fixed node lat/lng
  const minLat = Math.min(...CAMERA_NETWORK_NODES.map(n => n.lat));
  const maxLat = Math.max(...CAMERA_NETWORK_NODES.map(n => n.lat));
  const minLng = Math.min(...CAMERA_NETWORK_NODES.map(n => n.lng));
  const maxLng = Math.max(...CAMERA_NETWORK_NODES.map(n => n.lng));
  
  const getX = (lng) => ((lng - minLng) / (maxLng - minLng)) * 80 + 10;
  const getY = (lat) => 90 - (((lat - minLat) / (maxLat - minLat)) * 80 + 10);

  const getActiveEdgeIndex = (n1, n2) => {
    if (!activeRoute) return -1;
    for (let i = 0; i < activeRoute.length - 1; i++) {
      if ((activeRoute[i] === n1 && activeRoute[i+1] === n2) || 
          (activeRoute[i] === n2 && activeRoute[i+1] === n1)) {
        return i;
      }
    }
    return -1;
  };

  return (
    <div className="rounded-[24px] border border-white/80 bg-gray-900 p-5 shadow-[0_8px_32px_rgba(0,0,0,.15)] relative overflow-hidden mt-5">
      <div className="absolute top-4 left-4 z-10 text-[9px] font-extrabold uppercase tracking-widest text-gray-400">
        Camera Network Graph
      </div>
      
      <div className="absolute bottom-4 left-4 z-10 flex gap-3 text-[9px] font-bold text-gray-500">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500"></span> Active Route</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-600"></span> Inactive</span>
      </div>

      <svg className="w-full h-48" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        {/* Edges */}
        {CAMERA_NETWORK_EDGES.map(([n1, n2], i) => {
          const node1 = CAMERA_NETWORK_NODES.find(n => n.id === n1);
          const node2 = CAMERA_NETWORK_NODES.find(n => n.id === n2);
          const routeIndex = getActiveEdgeIndex(n1, n2);
          const isActiveEdge = routeIndex !== -1;
          
          return (
            <line
              key={i}
              x1={getX(node1.lng)} y1={getY(node1.lat)}
              x2={getX(node2.lng)} y2={getY(node2.lat)}
              stroke={isActiveEdge ? "#3b82f6" : "#374151"}
              strokeWidth={isActiveEdge ? "0.8" : "0.3"}
              className={isActiveEdge ? "drop-shadow-[0_0_2px_rgba(59,130,246,0.8)]" : ""}
            />
          );
        })}

        {/* Nodes */}
        {CAMERA_NETWORK_NODES.map((node) => {
          const isVisited = activeRoute?.includes(node.id);
          const isCurrent = currentCamera === node.id;
          
          return (
            <g key={node.id}>
              {isCurrent && (
                <circle cx={getX(node.lng)} cy={getY(node.lat)} r="3" fill="#60a5fa" className="animate-ping opacity-50" />
              )}
              <circle 
                cx={getX(node.lng)} 
                cy={getY(node.lat)} 
                r={isCurrent ? "2" : "1.5"} 
                fill={isCurrent ? "#60a5fa" : isVisited ? "#3b82f6" : "#4b5563"} 
              />
              <text 
                x={getX(node.lng)} y={getY(node.lat) - 3} 
                fontSize="3" 
                fill={isVisited ? "#e5e7eb" : "#9ca3af"} 
                textAnchor="middle"
                className="font-mono font-bold"
              >
                {node.id.split(" ")[1]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
