import { useState } from "react";
import { applyCommand, legalCommands, phaseOf, waveExit } from "./engine";
import type { Command, CourtState, CourtTransition, Find, Position } from "./types";
import "./inspect.css";

const columns = ["Left", "Center", "Right"] as const;
const rows = ["dock bank", "near bridge landing", "bridge", "far bridge landing", "far shore"] as const;
const finds: Record<Find, string> = { lens: "Beacon Lens", moth: "wind-moth", vane: "Signal Vane" };
const capitalize = (text: string) => text[0]!.toUpperCase() + text.slice(1);
const footing = (position: Position) => `${columns[position.x]} ${rows[position.y]}`;

export function commandName(command: Command) {
  if (command.startsWith("step:")) return capitalize(command.slice(5));
  if (command.startsWith("take:")) return `Carry ${finds[command.slice(5) as Find]}`;
  if (command.startsWith("reel:")) return `Reel ${finds[command.slice(5) as Find]}`;
  if (command.startsWith("lure:")) return `Lure ${capitalize(command.slice(5))}`;
  if (command === "turn:vane") return "Turn wind-wheel";
  if (command === "return") return "Return to harbor";
  return "Wait for the tide";
}

function describeMove({ before, after, events }: CourtTransition): string {
  if (after.outcome === "returned") {
    const cargo = after.cargo.map(item => finds[item]).join(" and ");
    return cargo ? `Return safely with the ${cargo}.` : "Return safely with an empty pack.";
  }
  if (after.outcome === "rescued") {
    const reason = after.resolve === 0 ? "Mochi uses the last Resolve." : "This is the last turn before the flood.";
    return `${reason} Bram brings Mochi home. The pack comes back empty.`;
  }

  const facts: string[] = [];
  const pickup = events.find(event => event.kind === "pickup");
  if (pickup) facts.push(`The ${finds[pickup.item]} goes into the pack.`);
  if (before.orientation !== after.orientation) {
    facts.push(after.orientation === 0 ? "The wheel aligns." : "The wheel turns one notch.");
  }
  const wave = events.find(event => event.kind === "wave");
  if (wave) {
    const channel = columns[wave.exit].toLowerCase();
    const changesBridge = before.bridge !== after.bridge;
    facts.push(`${columns[wave.source]} source → ${columns[wave.exit]} wave. Bridge ${changesBridge ? "moves" : "stays"} ${channel}.`);
    if (events.some(event => event.kind === "open")) {
      facts.push(after.area === "wind" ? `The ${channel} channel charges.` : `The ${channel} oyster opens.`);
    }
    facts.push(after.resolve < before.resolve ? `Splash. Resolve ${after.resolve}/3.` : "Mochi stays dry.");
  } else {
    const exit = waveExit(after);
    if (after.locked !== null && exit !== null) {
      facts.push(`${columns[after.locked]} is marked for the next surge.`);
      if (after.area === "wind") facts.push(`At this wheel setting the wave exits ${columns[exit].toLowerCase()}.`);
    } else {
      facts.push(`Next is rising tide. The bridge stays ${columns[after.bridge].toLowerCase()}.`);
    }
  }
  return facts.join(" ");
}

export function forecast(state: CourtState, selected: Command | null): string {
  const transition = selected && applyCommand(state, selected);
  if (transition) return describeMove(transition);
  const exit = waveExit(state);
  if (exit !== null && state.locked !== null) {
    return `${columns[state.locked]} source → ${columns[exit]} wave. The bridge will ${exit === state.bridge ? "stay" : "move"} ${columns[exit].toLowerCase()}.`;
  }
  return phaseOf(state) === "rising"
    ? "Your next position marks the source of the surge."
    : "The water is quiet. Choose a neighboring foothold.";
}

export default function Inspect({ state }: { state: CourtState }) {
  const [choice, setChoice] = useState<Command | null>(null);
  const preview = choice && applyCommand(state, choice);
  return <div className="exp-inspect">
    <h2>Inspect the tide</h2>
    <p>Compare a move before taking it. The tide waits here.</p>
    <dl className="exp-inspect-position">
      <div><dt>Mochi</dt><dd>{footing(state.position)}</dd></div>
      <div><dt>Bridge</dt><dd>{columns[state.bridge]} crossing</dd></div>
    </dl>
    <fieldset className="exp-inspect-actions">
      <legend>Preview a move</legend>
      <div>{legalCommands(state).map(command => <button key={command} type="button"
        aria-pressed={choice === command} data-preview-command={command} onClick={() => setChoice(command)}>
        {command.startsWith("step:") ? `Step ${command.slice(5)}` : commandName(command)}
      </button>)}</div>
    </fieldset>
    <div className="exp-inspect-reading" role="status" aria-live="polite" aria-atomic="true">
      <h3>{choice ? commandName(choice) : capitalize(phaseOf(state)) + " tide"}</h3>
      <p>{preview ? describeMove(preview) : forecast(state, null)}</p>
      {preview && preview.after.outcome === "active" && <p>
        Mochi ends at the {footing(preview.after.position).toLowerCase()}.
        {state.uses !== preview.after.uses && ` ${capitalize(state.tool)} uses left: ${preview.after.uses}.`}
      </p>}
    </div>
  </div>;
}
