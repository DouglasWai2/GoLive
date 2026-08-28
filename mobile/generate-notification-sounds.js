const fs = require("node:fs");
const path = require("node:path");

const definition = require("../packages/core/src/notificationSoundTones.json");
const {
  attackDuration,
  gainFloor,
  sampleRate,
  sounds,
  tailDuration,
} = definition;

function envelope(elapsed, duration, volume) {
  const attack = Math.min(attackDuration, duration);

  if (elapsed <= attack) {
    return gainFloor * Math.pow(volume / gainFloor, elapsed / attack);
  }

  return volume * Math.pow(gainFloor / volume, (elapsed - attack) / (duration - attack));
}

function wavBuffer(samples) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  samples.forEach((sample, index) => {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + index * 2);
  });

  return buffer;
}

function renderSound(soundTones) {
  const duration = Math.max(...soundTones.map(([, delay, toneDuration]) => delay + toneDuration)) + tailDuration;
  const samples = new Float32Array(Math.ceil(duration * sampleRate));

  for (const [frequency, delay, toneDuration, volume] of soundTones) {
    const start = Math.floor(delay * sampleRate);
    const end = Math.min(samples.length, Math.ceil((delay + toneDuration) * sampleRate));

    for (let index = start; index < end; index += 1) {
      const elapsed = index / sampleRate - delay;
      samples[index] += Math.sin(2 * Math.PI * frequency * elapsed) * envelope(elapsed, toneDuration, volume);
    }
  }

  return wavBuffer(samples);
}

const outputDirectory = path.join(__dirname, "assets", "notification-sounds");
fs.mkdirSync(outputDirectory, { recursive: true });

for (const file of fs.readdirSync(outputDirectory)) {
  if (file.endsWith(".wav")) fs.rmSync(path.join(outputDirectory, file));
}

for (const [name, soundTones] of Object.entries(sounds)) {
  fs.writeFileSync(path.join(outputDirectory, `${name}.wav`), renderSound(soundTones));
}

fs.writeFileSync(
  path.join(outputDirectory, "room-active.wav"),
  wavBuffer(new Float32Array(sampleRate)),
);
