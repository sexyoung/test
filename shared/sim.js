// Deterministic, engine-agnostic simulation. It owns no rendering objects: every frame it
// writes a local position + rotation for each dynamic node into typed arrays, and a camera
// pose. Each demo copies those values onto its own scene-graph nodes.
//
//   const sim = createSim(world, { input: harness.input, autopilot: harness.params.bench });
//   sim.update(time, dt);
//   sim.positions    Float32Array(nodeCount * 3)  local position of node i at [i*3 .. i*3+2]
//   sim.quaternions  Float32Array(nodeCount * 4)  local rotation (x, y, z, w) at [i*4 .. i*4+3]
//   sim.scales       Float32Array(nodeCount)      constant uniform local scale
//   sim.camera.eye / sim.camera.target            Float32Array(3) each, world space, up = +Y

import { groundHeight, isWalkable, terrainHeight, sampleLane } from './world.js';
import { clamp } from './math.js';

export function createSim(world, { input = null, autopilot = false } = {}) {
  const nodes = world.dynamics.nodes;
  const count = nodes.length;
  const positions = new Float32Array(count * 3);
  const quaternions = new Float32Array(count * 4);
  const scales = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions.set(nodes[i].position, i * 3);
    quaternions[i * 4 + 3] = 1;
    scales[i] = nodes[i].scale;
  }

  const { actors, lanes, layout, env } = world;
  const camera = { eye: new Float32Array(3), target: new Float32Array(3) };
  const tmp = { x: 0, z: 0, tx: 0, tz: 0 };

  const setPos = (i, x, y, z) => { positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z; };
  const setQuat = (i, x, y, z, w) => { quaternions[i * 4] = x; quaternions[i * 4 + 1] = y; quaternions[i * 4 + 2] = z; quaternions[i * 4 + 3] = w; };
  const setYaw = (i, a) => setQuat(i, 0, Math.sin(a / 2), 0, Math.cos(a / 2));
  const setRotX = (i, a) => setQuat(i, Math.sin(a / 2), 0, 0, Math.cos(a / 2));
  const setRotZ = (i, a) => setQuat(i, 0, 0, Math.sin(a / 2), Math.cos(a / 2));

  /** Pose a 7-node humanoid: root transform plus a simple walk cycle. `amount` 0 = standing, 1 = walking. */
  function poseHumanoid(a, x, y, z, yaw, phase, amount) {
    setPos(a.root, x, y + Math.abs(Math.sin(phase)) * 0.035 * amount, z);
    setYaw(a.root, yaw);
    const swing = Math.sin(phase) * 0.72 * amount;
    setRotX(a.legL, swing);
    setRotX(a.legR, -swing);
    setRotX(a.armL, -swing * 0.85);
    setRotX(a.armR, swing * 0.85);
    setYaw(a.torso, Math.sin(phase) * 0.09 * amount);
    setRotX(a.head, Math.sin(phase * 2) * 0.03 * amount);
  }

  // ---- player -------------------------------------------------------------
  const start = actors.player.start;
  const player = { x: start.x, z: start.z, y: groundHeight(start.x, start.z), vy: 0, yaw: start.yaw, phase: 0, amount: 0, grounded: true };
  const cam = { yaw: -0.16, pitch: 0.06, dist: 6.9 };

  function updatePlayer(time, dt) {
    if (autopilot) {
      // walk the main loop at a steady pace (pure function of time)
      const lane = lanes[0], speed = 1.7;
      sampleLane(lane, 20 + speed * time, 0.6, tmp);
      player.x = tmp.x; player.z = tmp.z; player.y = terrainHeight(tmp.x, tmp.z);
      player.yaw = Math.atan2(tmp.tx, tmp.tz);
      player.phase = speed * time * 2.9;
      player.amount = 1;
      return;
    }
    const s = input ? input.sample() : null;
    let moving = false;
    if (s && dt > 0) {
      cam.yaw -= s.lookX * 0.0055;
      cam.pitch = clamp(cam.pitch + s.lookY * 0.004, -0.2, 1.25);
      cam.dist = clamp(cam.dist * Math.exp(s.zoom * 0.0012), 2.5, 32);
      const mx = s.moveX, mz = s.moveZ, len = Math.hypot(mx, mz);
      if (len > 0.01) {
        const speed = (s.run ? 6.6 : 3.3) * Math.min(1, len);
        // camera-relative: forward = away from the camera, right = camera right
        const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
        const dx = ((fx * mz + rx * mx) / len) * speed * dt, dz = ((fz * mz + rz * mx) / len) * speed * dt;
        if (isWalkable(player.x + dx, player.z + dz)) { player.x += dx; player.z += dz; }
        else if (isWalkable(player.x + dx, player.z)) player.x += dx;
        else if (isWalkable(player.x, player.z + dz)) player.z += dz;
        let turn = Math.atan2(dx, dz) - player.yaw;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        player.yaw += turn * Math.min(1, dt * 12);
        player.phase += speed * dt * 2.9;
        moving = true;
      }
      if (s.jump && player.grounded) { player.vy = 5.4; player.grounded = false; }
    }
    if (dt > 0) {
      const ground = groundHeight(player.x, player.z);
      if (!player.grounded) {
        player.vy -= 15 * dt;
        player.y += player.vy * dt;
        if (player.y <= ground) { player.y = ground; player.vy = 0; player.grounded = true; }
      } else player.y = ground;
      player.amount += ((moving ? 1 : 0) - player.amount) * Math.min(1, dt * 10);
    }
  }

  function updateCamera(time) {
    if (autopilot) {
      // scripted fly-around above the tree tops, circling the pond (pure function of time)
      const a = 0.5 + (Math.PI * 2 * time) / 26;
      const radius = 40 + 9 * Math.sin((Math.PI * 2 * time) / 13);
      const cx = layout.pond.cx - 4, cz = layout.pond.cz + 6;
      camera.eye[0] = cx + Math.sin(a) * radius;
      camera.eye[1] = 15 + 3.5 * Math.sin((Math.PI * 2 * time) / 9 + 1);
      camera.eye[2] = cz + Math.cos(a) * radius;
      camera.target[0] = cx + 3 * Math.sin(time / 5);
      camera.target[1] = 1.5 + 0.5 * Math.sin(time / 3);
      camera.target[2] = cz - 2 + 3 * Math.cos(time / 4);
      return;
    }
    const px = player.x, py = player.y + 1.5, pz = player.z;
    const cp = Math.cos(cam.pitch);
    let ex = px + Math.sin(cam.yaw) * cp * cam.dist;
    let ey = py + Math.sin(cam.pitch) * cam.dist;
    let ez = pz + Math.cos(cam.yaw) * cp * cam.dist;
    ey = Math.max(ey, terrainHeight(ex, ez) + 0.45, env.waterLevel + 0.45);
    camera.eye[0] = ex; camera.eye[1] = ey; camera.eye[2] = ez;
    camera.target[0] = px;
    camera.target[1] = py + 0.3 + 0.075 * cam.dist; // look a little above the player: more sky, player in the lower third
    camera.target[2] = pz;
  }

  function update(time, dt) {
    updatePlayer(time, dt);
    poseHumanoid(actors.player, player.x, player.y, player.z, player.yaw, player.phase, player.amount);

    for (let i = 0; i < actors.npcs.length; i++) {
      const a = actors.npcs[i];
      const lane = lanes[a.lane];
      sampleLane(lane, a.s0 + a.dir * a.speed * time, a.lateral, tmp);
      poseHumanoid(a, tmp.x, terrainHeight(tmp.x, tmp.z), tmp.z, Math.atan2(tmp.tx * a.dir, tmp.tz * a.dir), a.phase + a.speed * time * 2.9, 1);
    }

    for (let i = 0; i < actors.birds.length; i++) {
      const b = actors.birds[i];
      const ang = b.phase + b.speed * time, dir = Math.sign(b.speed);
      const x = b.cx + Math.cos(ang) * b.radius, z = b.cz + Math.sin(ang) * b.radius;
      const yaw = Math.atan2(-Math.sin(ang) * dir, Math.cos(ang) * dir), roll = -0.35 * dir;
      setPos(b.root, x, b.height + 1.5 * Math.sin(time * 0.4 + b.phase), z);
      const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sz = Math.sin(roll / 2), cz = Math.cos(roll / 2);
      setQuat(b.root, sy * sz, sy * cz, cy * sz, cy * cz); // yaw, then roll about the flight direction
      const flap = 0.2 + 0.62 * Math.sin(time * 9 + b.phase * 3);
      setRotZ(b.wingR, flap);
      setRotZ(b.wingL, -flap);
    }

    for (let i = 0; i < actors.clouds.length; i++) {
      const c = actors.clouds[i];
      const az = c.az + (c.speed / c.dist) * time;
      setPos(c.node, layout.park.x + Math.sin(az) * c.dist, c.y, layout.park.z - Math.cos(az) * c.dist);
      setYaw(c.node, c.yaw - az);
    }

    for (let i = 0; i < actors.ducks.length; i++) {
      const d = actors.ducks[i];
      const ang = d.phase + d.speed * time, dir = Math.sign(d.speed);
      setPos(d.node, d.cx + Math.cos(ang) * d.radius, env.waterLevel - 0.02 + 0.02 * Math.sin(time * 2.1 + d.phase), d.cz + Math.sin(ang) * d.radius);
      setYaw(d.node, Math.atan2(-Math.sin(ang) * dir, Math.cos(ang) * dir));
    }

    const sun = actors.sun, q = sun.quaternion;
    setPos(sun.disc, sun.position[0], sun.position[1], sun.position[2]);
    setQuat(sun.disc, q[0], q[1], q[2], q[3]);
    setRotZ(sun.rays, time * 0.12);

    updateCamera(time);
  }

  update(0, 0);
  return { positions, quaternions, scales, camera, update, player, cam, nodeCount: count };
}
