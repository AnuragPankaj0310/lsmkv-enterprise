import type { RingNode, RingKey } from "../../types/hashRing";
import { RING_SIZE } from "../../utils/ringConstants";
import Ring from "./Ring";
import Nodes from "./Nodes";
import Keys from "./Keys";
import RebalancingTokens from "./RebalancingTokens";
import { useCluster } from "../../context/ClusterContext";

export interface HashRingCanvasProps {
  nodes: RingNode[];
  keys: RingKey[];
}

/**
 * HashRingCanvas — the fixed-size SVG container.
 * Layers: Ring (static) → Keys → Nodes (top, so labels are readable).
 * RebalancingTokens: overlay when any node is in REBALANCING state.
 */
export default function HashRingCanvas({ nodes, keys }: HashRingCanvasProps) {
  const { nodes: runtimeNodes } = useCluster();

  const rebalancingNodeIds = runtimeNodes
    .filter((n) => n.state === "REBALANCING")
    .map((n) => n.id);

  return (
    <div className="flex justify-center pt-16 pb-32">
      <div
        className="relative"
        style={{ width: RING_SIZE, height: RING_SIZE, margin: "0 60px" }}
      >
        <Ring />
        <Keys keys={keys} nodes={nodes} />
        <Nodes nodes={nodes} keys={keys} />
        {/* Rebalancing animation — tokens arc along the ring when any node is rebalancing */}
        {rebalancingNodeIds.length > 0 && (
          <RebalancingTokens nodes={nodes} rebalancingNodeIds={rebalancingNodeIds} />
        )}
      </div>
    </div>
  );
}
