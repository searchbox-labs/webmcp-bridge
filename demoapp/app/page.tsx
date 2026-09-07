import { PodsOnMarsApp } from "./PodsOnMars-FM/pods-on-mars-app";
import { DemoVideoGate } from "./demo-video-gate";

export default function HomePage() {
  return (
    <DemoVideoGate>
      <PodsOnMarsApp />
    </DemoVideoGate>
  );
}
