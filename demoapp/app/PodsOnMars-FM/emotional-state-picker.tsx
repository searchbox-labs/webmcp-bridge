"use client";

import { useState } from "react";
import {
  createEmotionalState,
  emotionRegions,
  type EmotionalCheckIn,
  type EmotionRegion,
  type TransitionSpeed,
} from "./emotional-state";

type Selection = Record<string, number>;

const listeningTimes = [15, 30, 45, 60] as const;
const transitionSpeeds: Array<{ value: TransitionSpeed; label: string; description: string }> = [
  { value: "gradual", label: "Gradual", description: "Meet me here first" },
  { value: "balanced", label: "Balanced", description: "Move me steadily" },
  { value: "direct", label: "Direct", description: "Change the energy now" },
];

export function EmotionalStatePicker({ onCapture }: { onCapture: (checkIn: EmotionalCheckIn) => void }) {
  const [region, setRegion] = useState<EmotionRegion>("Heavy");
  const [selection, setSelection] = useState<Selection>({});
  const [valence, setValence] = useState(0);
  const [arousal, setArousal] = useState(50);
  const [senseOfControl, setSenseOfControl] = useState(50);
  const [socialConnection, setSocialConnection] = useState(50);
  const [context, setContext] = useState("");
  const [listeningMinutes, setListeningMinutes] = useState<15 | 30 | 45 | 60>(45);
  const [transitionSpeed, setTransitionSpeed] = useState<TransitionSpeed>("balanced");
  const [error, setError] = useState<string | null>(null);

  const selected = Object.entries(selection);

  function toggleEmotion(name: string) {
    setError(null);
    setSelection((current) => {
      if (name in current) {
        const next = { ...current };
        delete next[name];
        return next;
      }
      return { ...current, [name]: 0.6 };
    });
  }

  function capture() {
    try {
      const state = createEmotionalState({
        emotions: selected.map(([name, intensity]) => ({ name, intensity })),
        valence: valence / 100,
        arousal: arousal / 100,
        senseOfControl: senseOfControl / 100,
        socialConnection: socialConnection / 100,
        context,
      });
      onCapture({ emotionalState: state, listeningMinutes, transitionSpeed });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not capture this emotional state.");
    }
  }

  return (
    <section className="emotion-capture" aria-labelledby="emotion-capture-title">
      <div className="emotion-capture-heading">
        <div>
          <p className="emotion-kicker">Your emotional coordinates</p>
          <h2 id="emotion-capture-title">What is present right now?</h2>
        </div>
        <p>Choose everything that fits. Mixed feelings belong here.</p>
      </div>

      <div className="emotion-region-tabs" role="tablist" aria-label="Emotion regions">
        {(Object.keys(emotionRegions) as EmotionRegion[]).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={region === name}
            className={region === name ? "is-active" : undefined}
            onClick={() => setRegion(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="emotion-options" role="group" aria-label={`${region} emotions`}>
        {emotionRegions[region].map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={name in selection}
            className={name in selection ? "is-selected" : undefined}
            onClick={() => toggleEmotion(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {selected.length > 0 ? (
        <fieldset className="emotion-intensities">
          <legend>How strongly do you feel each one?</legend>
          {selected.map(([name, intensity]) => (
            <label key={name}>
              <span>{name}</span>
              <input
                aria-label={`${name} intensity`}
                type="range"
                min="0"
                max="100"
                value={Math.round(intensity * 100)}
                onChange={(event) => setSelection((current) => ({ ...current, [name]: Number(event.target.value) / 100 }))}
              />
              <output>{Math.round(intensity * 100)}%</output>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="emotion-empty">Choose one or more emotions to shape your state.</p>
      )}

      <fieldset className="emotion-dimensions">
        <legend>Shape the feeling</legend>
        <label>
          <span>Feeling tone <small>painful to pleasant</small></span>
          <input aria-label="Feeling tone" type="range" min="-100" max="100" value={valence} onChange={(event) => setValence(Number(event.target.value))} />
          <output>{valence}</output>
        </label>
        <label>
          <span>Energy <small>still to activated</small></span>
          <input aria-label="Energy" type="range" min="0" max="100" value={arousal} onChange={(event) => setArousal(Number(event.target.value))} />
          <output>{arousal}</output>
        </label>
        <label>
          <span>Sense of control <small>carried to capable</small></span>
          <input aria-label="Sense of control" type="range" min="0" max="100" value={senseOfControl} onChange={(event) => setSenseOfControl(Number(event.target.value))} />
          <output>{senseOfControl}</output>
        </label>
        <label>
          <span>Connection <small>alone to supported</small></span>
          <input aria-label="Connection" type="range" min="0" max="100" value={socialConnection} onChange={(event) => setSocialConnection(Number(event.target.value))} />
          <output>{socialConnection}</output>
        </label>
      </fieldset>

      <div className="emotion-context">
        <label htmlFor="emotion-context">Anything shaping this moment? <span>Optional</span></label>
        <textarea id="emotion-context" rows={3} value={context} onChange={(event) => setContext(event.target.value)} placeholder="A long day, a difficult conversation, a quiet win…" />
      </div>

      <div className="emotion-listening-plan">
        <fieldset>
          <legend>How long can you listen?</legend>
          <div className="emotion-choice-grid emotion-time-choices">
            {listeningTimes.map((minutes) => (
              <button key={minutes} type="button" aria-pressed={listeningMinutes === minutes} onClick={() => setListeningMinutes(minutes)}>
                {minutes} min
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>How should the feeling shift?</legend>
          <div className="emotion-choice-grid emotion-speed-choices">
            {transitionSpeeds.map(({ value, label, description }) => (
              <button key={value} type="button" aria-pressed={transitionSpeed === value} onClick={() => setTransitionSpeed(value)}>
                <strong>{label}</strong>
                <span>{description}</span>
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {error ? <p className="emotion-error" role="alert">{error}</p> : null}
      <button className="emotion-capture-button" type="button" onClick={capture}>Set my listening direction</button>
    </section>
  );
}
