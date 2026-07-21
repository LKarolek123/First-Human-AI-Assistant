const TARGET_SAMPLE_RATE = 16_000;
const MIN_SIGNAL_LEVEL = 0.012;
const NORMALIZED_PEAK = 0.92;
const SILENCE_PADDING_MS = 180;

export async function audioBlobToMono16k(blob: Blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const mono = mixToMono(audioBuffer);
    const resampled =
      audioBuffer.sampleRate === TARGET_SAMPLE_RATE
        ? mono
        : resample(mono, audioBuffer.sampleRate, TARGET_SAMPLE_RATE);

    return improveSpeechSignal(resampled, TARGET_SAMPLE_RATE);
  } finally {
    await audioContext.close();
  }
}

function mixToMono(audioBuffer: AudioBuffer) {
  const { length, numberOfChannels } = audioBuffer;
  const mono = new Float32Array(length);

  for (let channel = 0; channel < numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);

    for (let index = 0; index < length; index += 1) {
      mono[index] += data[index] / numberOfChannels;
    }
  }

  return mono;
}

function resample(input: Float32Array, sourceRate: number, targetRate: number) {
  const ratio = sourceRate / targetRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const fraction = sourceIndex - leftIndex;

    output[index] = input[leftIndex] + (input[rightIndex] - input[leftIndex]) * fraction;
  }

  return output;
}

function improveSpeechSignal(input: Float32Array, sampleRate: number) {
  const centered = removeDcOffset(input);
  const trimmed = trimSilence(centered, sampleRate);
  const gated = applySoftNoiseGate(trimmed);

  return normalizePeak(gated);
}

function removeDcOffset(input: Float32Array) {
  if (input.length === 0) {
    return input;
  }

  let sum = 0;

  for (let index = 0; index < input.length; index += 1) {
    sum += input[index];
  }

  const offset = sum / input.length;
  const output = new Float32Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    output[index] = input[index] - offset;
  }

  return output;
}

function trimSilence(input: Float32Array, sampleRate: number) {
  if (input.length === 0) {
    return input;
  }

  const threshold = getAdaptiveThreshold(input);
  const padding = Math.round((SILENCE_PADDING_MS / 1_000) * sampleRate);
  let start = 0;
  let end = input.length - 1;

  while (start < input.length && Math.abs(input[start]) < threshold) {
    start += 1;
  }

  while (end > start && Math.abs(input[end]) < threshold) {
    end -= 1;
  }

  if (start >= end) {
    return input;
  }

  const paddedStart = Math.max(0, start - padding);
  const paddedEnd = Math.min(input.length, end + padding);

  return input.slice(paddedStart, paddedEnd);
}

function applySoftNoiseGate(input: Float32Array) {
  const threshold = getAdaptiveThreshold(input) * 0.65;
  const output = new Float32Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    const sample = input[index];
    const level = Math.abs(sample);

    output[index] = level < threshold ? sample * 0.2 : sample;
  }

  return output;
}

function normalizePeak(input: Float32Array) {
  let peak = 0;

  for (let index = 0; index < input.length; index += 1) {
    peak = Math.max(peak, Math.abs(input[index]));
  }

  if (peak < MIN_SIGNAL_LEVEL) {
    return input;
  }

  const gain = Math.min(NORMALIZED_PEAK / peak, 8);
  const output = new Float32Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    output[index] = clamp(input[index] * gain);
  }

  return output;
}

function getAdaptiveThreshold(input: Float32Array) {
  if (input.length === 0) {
    return MIN_SIGNAL_LEVEL;
  }

  let squareSum = 0;

  for (let index = 0; index < input.length; index += 1) {
    squareSum += input[index] * input[index];
  }

  const rms = Math.sqrt(squareSum / input.length);

  return Math.max(MIN_SIGNAL_LEVEL, rms * 0.35);
}

function clamp(value: number) {
  return Math.max(-1, Math.min(1, value));
}

