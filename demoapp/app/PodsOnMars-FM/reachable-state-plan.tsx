import type { ReachableStatePlan } from "./reachable-state-planner";

export function ReachableStatePlan({ plan }: { plan: ReachableStatePlan }) {
  return (
    <section className="reachable-plan" aria-labelledby="reachable-plan-title" aria-live="polite">
      <div className="reachable-plan-heading">
        <div>
          <p>Your emotional route</p>
          <h2 id="reachable-plan-title">A reachable next step</h2>
        </div>
        <span>{plan.transitionIntensity} shift · about {plan.transitionMinutes} minutes</span>
      </div>

      <ol className="reachable-plan-steps">
        <li>
          <span>Now</span>
          <strong>{plan.current}</strong>
          <p>The music begins by meeting you here.</p>
        </li>
        <li className="is-next">
          <span>Next</span>
          <strong>{plan.next}</strong>
          <p>The first constructive state within reach.</p>
        </li>
        <li>
          <span>Destination</span>
          <strong>{plan.destination}</strong>
          <p>Where the full {plan.totalMinutes}-minute listening arc can gently lead.</p>
        </li>
      </ol>
    </section>
  );
}
