import Link from "next/link";

const sdkRepository = "https://github.com/searchbox-labs/webmcp-bridge";
const runtimeRepository = "https://github.com/s29papi/webmcp-bridge-demoagent";

const steps = [
  {
    number: "01",
    title: "Install the prerequisites",
    body: "Use Node.js 24, npm, Zig 0.16, WSL, the Spotify desktop application, and spotify_cli.exe.",
    command: "node --version\nnpm --version\nzig version",
  },
  {
    number: "02",
    title: "Clone both repositories together",
    body: "The demo runtime intentionally consumes your local SDK checkout, so keep these directories beside each other.",
    command: `mkdir webmcp-bridge-demo && cd webmcp-bridge-demo\ngit clone ${sdkRepository}.git\ngit clone ${runtimeRepository}.git`,
  },
  {
    number: "03",
    title: "Build the SDK and runtime",
    body: "Install the SDK first, then compile the local Spotify launcher and install the Agent host.",
    command: "cd webmcp-bridge && npm install && npm run build\ncd ../webmcp-bridge-demoagent && zig build -Doptimize=ReleaseSafe\ncd agent-host && npm install",
  },
  {
    number: "04",
    title: "Start and register your runtime",
    body: "Keep this terminal open. It prints the secure registration page, a five-minute code, and later pairing activity.",
    command: "npm start -- runtime-register",
  },
  {
    number: "05",
    title: "Create the owner passkey",
    body: "Open the relay registration URL printed by the runtime, enter its code, choose an Agent name, and finish the passkey prompt.",
  },
  {
    number: "06",
    title: "Pair the live demo",
    body: "Return to the demo, select Connect Agent, choose the registered runtime, and approve the passkey request. Spotify and 0G keys remain local to the runtime.",
  },
];

export default function SetupGuidePage() {
  return (
    <main className="setup-guide">
      <nav className="setup-guide-nav" aria-label="Demo navigation">
        <Link href="/">← Live demo</Link>
        <a href={sdkRepository} target="_blank" rel="noreferrer">SDK repository</a>
        <a href={runtimeRepository} target="_blank" rel="noreferrer">Runtime repository</a>
      </nav>

      <header className="setup-guide-hero">
        <p>Local runtime setup</p>
        <h1>Bring your own Agent to the browser</h1>
        <span>Follow these steps once. Registration and pairing stay in the secure popup—not in the music interface.</span>
      </header>

      <ol className="setup-guide-steps">
        {steps.map((step) => (
          <li key={step.number}>
            <span className="setup-step-number">{step.number}</span>
            <div>
              <h2>{step.title}</h2>
              <p>{step.body}</p>
              {step.command ? <pre><code>{step.command}</code></pre> : null}
            </div>
          </li>
        ))}
      </ol>

      <section className="setup-guide-ready">
        <div>
          <p>Runtime online?</p>
          <h2>Continue with the live demo</h2>
        </div>
        <Link href="/">Open Pods On Mars</Link>
      </section>
    </main>
  );
}
