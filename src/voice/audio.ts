const TARGET_SAMPLE_RATE = 16_000;

export async function audioBlobToMono16k(blob: Blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const mono = mixToMono(audioBuffer);

    if (audioBuffer.sampleRate === TARGET_SAMPLE_RATE) {
      return mono;
    }

    return resample(mono, audioBuffer.sampleRate, TARGET_SAMPLE_RATE);
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

