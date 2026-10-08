import { version } from "../../package.json" with { type: "json" };

export function VersionInfo() {
  return (
    <div
      className="version-info"
      title="App version"
      aria-label={`GoLive version ${version}`}
    >
      v{version}
    </div>
  );
}