package org.webrtc.audio;

import android.util.Log;

public class AudioMixer {
    private static final String TAG = "AudioMixer";

    private float micGain = 1.0f;
    private float playbackGain = 0.5f;

    private short[] micBuffer;
    private short[] playbackBuffer;
    private short[] outputBuffer;

    private long micFramesReceived = 0;
    private long playbackFramesReceived = 0;
    private long framesMixed = 0;
    private long underruns = 0;
    private long overruns = 0;

    public AudioMixer(int frameSize) {
        micBuffer = new short[frameSize];
        playbackBuffer = new short[frameSize];
        outputBuffer = new short[frameSize];
    }

    public void setMicGain(float gain) {
        micGain = Math.max(0.0f, Math.min(2.0f, gain));
    }

    public void setPlaybackGain(float gain) {
        playbackGain = Math.max(0.0f, Math.min(2.0f, gain));
    }

    public float getMicGain() {
        return micGain;
    }

    public float getPlaybackGain() {
        return playbackGain;
    }

    public void mixFrames(short[] micFrame, int micFrames, short[] playbackFrame, int playbackFrames, short[] outFrame) {
        int frames = Math.max(micFrames, playbackFrames);
        if (frames > outFrame.length) {
            frames = outFrame.length;
        }

        for (int i = 0; i < frames; i++) {
            int micSample = (i < micFrames) ? micFrame[i] : 0;
            int playbackSample = (i < playbackFrames) ? playbackFrame[i] : 0;

            int mixed = (int) (micSample * micGain + playbackSample * playbackGain);
            outFrame[i] = saturate(mixed);
        }

        if (micFrames > 0) micFramesReceived += micFrames;
        if (playbackFrames > 0) playbackFramesReceived += playbackFrames;
        framesMixed += frames;

        if (micFrames == 0 && playbackFrames == 0) {
            underruns++;
        }
    }

    private short saturate(int sample) {
        if (sample > 32767) {
            overruns++;
            return 32767;
        }
        if (sample < -32768) {
            overruns++;
            return -32768;
        }
        return (short) sample;
    }

    public short[] getOutputBuffer() {
        return outputBuffer;
    }

    public void clearBuffers() {
        java.util.Arrays.fill(micBuffer, (short) 0);
        java.util.Arrays.fill(playbackBuffer, (short) 0);
        java.util.Arrays.fill(outputBuffer, (short) 0);
    }

    public long getMicFramesReceived() {
        return micFramesReceived;
    }

    public long getPlaybackFramesReceived() {
        return playbackFramesReceived;
    }

    public long getFramesMixed() {
        return framesMixed;
    }

    public long getUnderruns() {
        return underruns;
    }

    public long getOverruns() {
        return overruns;
    }

    public void logStats() {
        Log.d(TAG, String.format(
            "AudioMixer stats: micFrames=%d, playbackFrames=%d, mixed=%d, underruns=%d, overruns=%d",
            micFramesReceived, playbackFramesReceived, framesMixed, underruns, overruns
        ));
    }
}