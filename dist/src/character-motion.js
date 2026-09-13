// Action clocks are local monotonic clocks; the wire format carries age, not
// wall-clock timestamps, so another computer need not have a synchronized clock.
export const actionDuration = (kind) => (kind === 'place' ? 0.25 : 0.32);
export function startAction(actor, kind) {
  actor.actionSeq = ((actor.actionSeq || 0) + 1) >>> 0;
  actor.actionKind = kind;
  actor.actionAt = performance.now() / 1000;
}
export function actionPulse(actor, now = performance.now() / 1000) {
  const age = now - (actor.actionAt ?? -100);
  const duration = actionDuration(actor.actionKind);
  return age >= 0 && age < duration ? Math.sin((Math.PI * age) / duration) : 0;
}
export function limbAngle(actor, joint, time) {
  const moving = Math.hypot(actor.velocity.x, actor.velocity.z) > 0.2;
  let angle = moving
    ? Math.sin(time * 9 + actor.id) * 0.52 * (joint === 'legL' || joint === 'armR' ? 1 : -1)
    : 0;
  const pulse = actionPulse(actor);
  if (joint === 'armR') {
    if (actor.kind === 'player')
      angle = angle * 0.25 - 0.25 - pulse * (actor.actionKind === 'place' ? 1.05 : 1.7);
    else if (actor.attackTimer > 0.7)
      angle = -Math.sin(((1.1 - actor.attackTimer) / 0.4) * Math.PI) * 1.7;
  }
  if (joint === 'armL' && pulse) angle -= pulse * 0.25;
  return angle;
}
export const playerSkin = (id) =>
  [...String(id)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0) % 3;
