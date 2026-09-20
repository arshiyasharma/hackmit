import SenseLanding from "./SenseLanding";

/**
 * The Sense landing page is one client-only experience: a WebGL stage behind a
 * DOM layer, driven by the modules in /landing. Nothing here renders on the
 * server beyond the empty mount point.
 */
export default function Page() {
  return <SenseLanding />;
}
