package org.webrtc.audio;

import android.annotation.TargetApi;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.AudioTimestamp;
import android.media.MediaRecorder.AudioSource;
import android.media.projection.MediaProjection;
import android.os.Build;
import android.os.Process;
import androidx.annotation.Nullable;
import androidx.annotation.RequiresApi;
import java.nio.ByteBuffer;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.webrtc.CalledByNative;
import org.webrtc.Logging;
import org.webrtc.ThreadUtils;

class MixedAudioRecord {
    private static final String TAG = "MixedAudioRecord";

    private static final int CALLBACK_BUFFER_SIZE_MS = 10;
    private static final int BUFFERS_PER_SECOND = 1000 / CALLBACK_BUFFER_SIZE_MS;
    private static final int BUFFER_SIZE_FACTOR = 2;
    private static final long AUDIO_RECORD_THREAD_JOIN_TIMEOUT_MS = 2000;
    private static final int CHECK_REC_STATUS_DELAY_MS = 100;

    public static final int DEFAULT_AUDIO_SOURCE = AudioSource.VOICE_COMMUNICATION;
    public static final int DEFAULT_AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT;
    public static final int DEFAULT_SAMPLE_RATE = 48000;
    public static final int DEFAULT_CHANNELS = 1;

    private final Context context;
    private final AudioManager audioManager;
    private final ScheduledExecutorService executor;

    private final AudioMixer mixer;

    private AudioRecord micRecord;
    private AudioRecord playbackRecord;
    private Thread mixerThread;
    private volatile boolean recording = false;
    private volatile boolean micActive = false;
    private volatile boolean playbackActive = false;

    private MediaProjection mediaProjection;

    private long nativeAudioRecord;

    private volatile boolean microphoneMute = false;
    private final AtomicReference<Boolean> audioSourceMatchesRecordingSessionRef = new AtomicReference<>();

    private final AudioRecordErrorCallback errorCallback;
    private final AudioRecordStateCallback stateCallback;
    private final SamplesReadyCallback audioSamplesReadyCallback;
    private final boolean isAcousticEchoCancelerSupported;
    private final boolean isNoiseSuppressorSupported;

    private ByteBuffer byteBuffer;
    private byte[] emptyBytes;

    @Nullable
    private ScheduledFuture<String> future;

    interface AudioRecordErrorCallback {
        void onWebRtcAudioRecordInitError(String errorMessage);
        void onWebRtcAudioRecordStartError(int errorCode, String errorMessage);
        void onWebRtcAudioRecordError(String errorMessage);
    }

    interface AudioRecordStateCallback {
        void onWebRtcAudioRecordStart();
        void onWebRtcAudioRecordStop();
    }

    interface SamplesReadyCallback {
        void onWebRtcAudioRecordSamplesReady(AudioSamples samples);
    }

    static class AudioSamples {
        final int audioFormat;
        final int channelCount;
        final int sampleRate;
        final byte[] data;

        AudioSamples(int audioFormat, int channelCount, int sampleRate, byte[] data) {
            this.audioFormat = audioFormat;
            this.channelCount = channelCount;
            this.sampleRate = sampleRate;
            this.data = data;
        }
    }

    public MixedAudioRecord(Context context, AudioManager audioManager,
                            AudioRecordErrorCallback errorCallback,
                            AudioRecordStateCallback stateCallback,
                            SamplesReadyCallback audioSamplesReadyCallback,
                            boolean isAcousticEchoCancelerSupported,
                            boolean isNoiseSuppressorSupported) {
        this.context = context;
        this.audioManager = audioManager;
        this.executor = Executors.newSingleThreadScheduledExecutor(new ThreadFactory() {
            private int threadId = 0;
            @Override
            public Thread newThread(Runnable r) {
                Thread t = Executors.defaultThreadFactory().newThread(r);
                t.setName("MixedAudioRecordScheduler-" + threadId++);
                return t;
            }
        });
        this.mixer = new AudioMixer(DEFAULT_SAMPLE_RATE / BUFFERS_PER_SECOND);
        this.errorCallback = errorCallback;
        this.stateCallback = stateCallback;
        this.audioSamplesReadyCallback = audioSamplesReadyCallback;
        this.isAcousticEchoCancelerSupported = isAcousticEchoCancelerSupported;
        this.isNoiseSuppressorSupported = isNoiseSuppressorSupported;
        Logging.d(TAG, "ctor");
    }

    public synchronized boolean setMediaProjection(@Nullable MediaProjection mediaProjection) {
        if (mediaProjection != null && Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            Logging.e(TAG, "Audio playback capture requires Android Q or higher.");
            return false;
        }
        if (recording) {
            Logging.e(TAG, "Cannot change MediaProjection while recording is active.");
            return false;
        }
        this.mediaProjection = mediaProjection;
        playbackActive = (mediaProjection != null);
        return true;
    }

    public void setMicMute(boolean mute) {
        microphoneMute = mute;
    }

    public void setMicGain(float gain) {
        mixer.setMicGain(gain);
    }

    public void setPlaybackGain(float gain) {
        mixer.setPlaybackGain(gain);
    }

    @CalledByNative
    public void setNativeAudioRecord(long nativeAudioRecord) {
        this.nativeAudioRecord = nativeAudioRecord;
    }

    @CalledByNative
    private boolean isAcousticEchoCancelerSupported() {
        return isAcousticEchoCancelerSupported;
    }

    @CalledByNative
    private boolean isNoiseSuppressorSupported() {
        return isNoiseSuppressorSupported;
    }

    @CalledByNative
    private boolean isAudioConfigVerified() {
        return audioSourceMatchesRecordingSessionRef.get() != null;
    }

    @CalledByNative
    private boolean isAudioSourceMatchingRecordingSession() {
        Boolean match = audioSourceMatchesRecordingSessionRef.get();
        if (match == null) {
            Logging.w(TAG, "Audio configuration has not yet been verified");
            return false;
        }
        return match;
    }

    private class MixerThread extends Thread {
        private volatile boolean keepAlive = true;
        private AudioTimestamp audioTimestamp;

        public MixerThread() {
            super("MixedAudioRecordThread");
        }

        @Override
        public void run() {
            Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
            Logging.d(TAG, "MixerThread started");

            if (Build.VERSION.SDK_INT >= 24) {
                audioTimestamp = new AudioTimestamp();
            }

            doAudioRecordStateCallback(AUDIO_RECORD_START);

            while (keepAlive) {
                int micFrames = 0;
                int playbackFrames = 0;

                if (micActive && micRecord != null) {
                    micFrames = readFromRecord(micRecord, mixer.micBuffer);
                }

                if (playbackActive && playbackRecord != null) {
                    playbackFrames = readFromRecord(playbackRecord, mixer.playbackBuffer);
                }

                int frames = Math.max(micFrames, playbackFrames);
                if (frames > 0) {
                    mixer.mixFrames(mixer.micBuffer, micFrames, mixer.playbackBuffer, playbackFrames, mixer.outputBuffer);

                    if (microphoneMute) {
                        java.util.Arrays.fill(mixer.outputBuffer, 0, frames, (short) 0);
                    }

                    if (keepAlive && nativeAudioRecord != 0) {
                        long captureTimeNs = 0;
                        if (Build.VERSION.SDK_INT >= 24 && audioTimestamp != null) {
                            if (micRecord != null && micRecord.getTimestamp(audioTimestamp, AudioTimestamp.TIMEBASE_MONOTONIC) == AudioRecord.SUCCESS) {
                                captureTimeNs = audioTimestamp.nanoTime;
                            }
                        }
                        nativeDataIsRecorded(nativeAudioRecord, frames * 2, captureTimeNs);
                    }

                    if (audioSamplesReadyCallback != null) {
                        byte[] data = new byte[frames * 2];
                        ByteBuffer.wrap(data).asShortBuffer().put(mixer.outputBuffer, 0, frames);
                        audioSamplesReadyCallback.onWebRtcAudioRecordSamplesReady(
                            new AudioSamples(DEFAULT_AUDIO_FORMAT, DEFAULT_CHANNELS, DEFAULT_SAMPLE_RATE, data)
                        );
                    }
                } else if (!keepAlive) {
                    break;
                }

                try {
                    Thread.sleep(1);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }

            try {
                if (micRecord != null) micRecord.stop();
                if (playbackRecord != null) playbackRecord.stop();
                doAudioRecordStateCallback(AUDIO_RECORD_STOP);
            } catch (IllegalStateException e) {
                Logging.e(TAG, "AudioRecord.stop failed: " + e.getMessage());
            }
        }

        private int readFromRecord(AudioRecord record, short[] buffer) {
            int framesPerBuffer = buffer.length;
            int bytesPerFrame = 2;
            int bytesToRead = framesPerBuffer * bytesPerFrame;

            if (byteBuffer == null || byteBuffer.capacity() < bytesToRead) {
                byteBuffer = ByteBuffer.allocateDirect(bytesToRead);
                if (!(byteBuffer.hasArray())) {
                    Logging.e(TAG, "ByteBuffer does not have backing array");
                    return 0;
                }
            }

            byteBuffer.clear();
            int bytesRead = record.read(byteBuffer, bytesToRead);
            if (bytesRead == bytesToRead) {
                byteBuffer.asShortBuffer().get(buffer, 0, framesPerBuffer);
                return framesPerBuffer;
            } else if (bytesRead > 0 && bytesRead % 2 == 0) {
                int frames = bytesRead / 2;
                byteBuffer.asShortBuffer().get(buffer, 0, frames);
                return frames;
            } else if (bytesRead < 0) {
                String error = "AudioRecord.read failed: " + bytesRead;
                Logging.e(TAG, error);
                keepAlive = false;
                reportError(error);
                return 0;
            }
            return 0;
        }

        public void stopThread() {
            keepAlive = false;
        }
    }

    private static final int AUDIO_RECORD_START = 0;
    private static final int AUDIO_RECORD_STOP = 1;

    @TargetApi(Build.VERSION_CODES.M)
    private AudioRecord createAudioRecordOnMOrHigher(
            int audioSource, int sampleRate, int channelConfig, int audioFormat, int bufferSizeInBytes) {
        Logging.d(TAG, "createAudioRecordOnMOrHigher");
        return new AudioRecord.Builder()
            .setAudioSource(audioSource)
            .setAudioFormat(new AudioFormat.Builder()
                    .setEncoding(audioFormat)
                    .setSampleRate(sampleRate)
                    .setChannelMask(channelConfig)
                    .build())
            .setBufferSizeInBytes(bufferSizeInBytes)
            .build();
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private AudioRecord createAudioPlaybackCaptureRecord(MediaProjection mediaProjection,
            int sampleRate, int channelConfig, int audioFormat, int bufferSizeInBytes) {
        Logging.d(TAG, "createAudioPlaybackCaptureRecord");
        AudioPlaybackCaptureConfiguration playbackConfig =
            new AudioPlaybackCaptureConfiguration.Builder(mediaProjection)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .build();

        return new AudioRecord.Builder()
            .setAudioPlaybackCaptureConfig(playbackConfig)
            .setAudioFormat(new AudioFormat.Builder()
                    .setEncoding(audioFormat)
                    .setSampleRate(sampleRate)
                    .setChannelMask(channelConfig)
                    .build())
            .setBufferSizeInBytes(bufferSizeInBytes)
            .build();
    }

    private AudioRecord createAudioRecordOnLowerThanM(
            int audioSource, int sampleRate, int channelConfig, int audioFormat, int bufferSizeInBytes) {
        Logging.d(TAG, "createAudioRecordOnLowerThanM");
        return new AudioRecord(audioSource, sampleRate, channelConfig, audioFormat, bufferSizeInBytes);
    }

    @CalledByNative
    private synchronized int initRecording(int sampleRate, int channels) {
        Logging.d(TAG, "initRecording(sampleRate=" + sampleRate + ", channels=" + channels + ")");
        if (micRecord != null || playbackRecord != null) {
            reportInitError("InitRecording called twice without StopRecording.");
            return -1;
        }

        final int bytesPerFrame = channels * 2;
        final int framesPerBuffer = sampleRate / BUFFERS_PER_SECOND;
        int bufferSizeInBytes = Math.max(
            BUFFER_SIZE_FACTOR * AudioRecord.getMinBufferSize(sampleRate, channelCountToConfiguration(channels), DEFAULT_AUDIO_FORMAT),
            framesPerBuffer * bytesPerFrame
        );

        int micFrames = 0;
        int playbackFrames = 0;

        try {
            if (playbackActive && mediaProjection != null) {
                playbackRecord = createAudioPlaybackCaptureRecord(mediaProjection, sampleRate,
                    channelCountToConfiguration(channels), DEFAULT_AUDIO_FORMAT, bufferSizeInBytes);
                playbackFrames = framesPerBuffer;
            }

            if (!playbackActive || micActive) {
                micRecord = createAudioRecordOnMOrHigher(
                    DEFAULT_AUDIO_SOURCE, sampleRate, channelCountToConfiguration(channels),
                    DEFAULT_AUDIO_FORMAT, bufferSizeInBytes);
                micFrames = framesPerBuffer;
                micActive = true;
            }

            if (micRecord == null && playbackRecord == null) {
                reportInitError("Failed to create any AudioRecord");
                return -1;
            }

            byteBuffer = ByteBuffer.allocateDirect(framesPerBuffer * 2);
            if (!(byteBuffer.hasArray())) {
                reportInitError("ByteBuffer does not have backing array.");
                return -1;
            }
            emptyBytes = new byte[byteBuffer.capacity()];

            if (micRecord != null) {
                nativeCacheDirectBufferAddress(nativeAudioRecord, byteBuffer);
            }

            logMainParameters();
            return framesPerBuffer;
        } catch (RuntimeException e) {
            reportInitError(e.getMessage());
            releaseAudioResources();
            return -1;
        }
    }

    @CalledByNative
    private boolean startRecording() {
        Logging.d(TAG, "startRecording");
        recording = true;

        try {
            if (micRecord != null) {
                micRecord.startRecording();
                if (micRecord.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                    reportStartError(1, "Mic AudioRecord failed to start");
                    return false;
                }
                micActive = true;
            }
            if (playbackRecord != null) {
                playbackRecord.startRecording();
                if (playbackRecord.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                    reportStartError(2, "Playback AudioRecord failed to start");
                    if (micRecord != null) {
                        try { micRecord.stop(); } catch (Exception ignored) {}
                    }
                    return false;
                }
                playbackActive = true;
            }
        } catch (IllegalStateException e) {
            reportStartError(0, "AudioRecord.startRecording failed: " + e.getMessage());
            return false;
        }

        mixerThread = new MixerThread();
        mixerThread.start();
        scheduleLogRecordingConfigurationsTask();
        return true;
    }

    @CalledByNative
    private synchronized boolean stopRecording() {
        Logging.d(TAG, "stopRecording");
        recording = false;

        if (future != null) {
            future.cancel(true);
            future = null;
        }

        if (mixerThread != null) {
            mixerThread.stopThread();
            try {
                mixerThread.join(AUDIO_RECORD_THREAD_JOIN_TIMEOUT_MS);
            } catch (InterruptedException e) {
                Logging.e(TAG, "Join of MixerThread timed out");
            }
            mixerThread = null;
        }

        if (micRecord != null) {
            try { micRecord.stop(); } catch (Exception ignored) {}
            micRecord.release();
            micRecord = null;
        }
        if (playbackRecord != null) {
            try { playbackRecord.stop(); } catch (Exception ignored) {}
            playbackRecord.release();
            playbackRecord = null;
        }

        micActive = false;
        playbackActive = false;
        audioSourceMatchesRecordingSessionRef.set(null);
        doAudioRecordStateCallback(AUDIO_RECORD_STOP);
        return true;
    }

    private void logMainParameters() {
        if (micRecord != null) {
            Logging.d(TAG, "Mic AudioRecord: session ID=" + micRecord.getAudioSessionId()
                + ", channels=" + micRecord.getChannelCount() + ", sample rate=" + micRecord.getSampleRate());
        }
        if (playbackRecord != null) {
            Logging.d(TAG, "Playback AudioRecord: session ID=" + playbackRecord.getAudioSessionId()
                + ", channels=" + playbackRecord.getChannelCount() + ", sample rate=" + playbackRecord.getSampleRate());
        }
    }

    private void scheduleLogRecordingConfigurationsTask() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return;

        Callable<String> callable = () -> {
            if (micRecord != null) {
                logRecordingConfigurations(micRecord, false);
            }
            if (playbackRecord != null) {
                logRecordingConfigurations(playbackRecord, false);
            }
            return "Scheduled task done";
        };

        if (future != null && !future.isDone()) {
            future.cancel(true);
        }
        future = executor.schedule(callable, CHECK_REC_STATUS_DELAY_MS, TimeUnit.MILLISECONDS);
    }

    private int logRecordingConfigurations(AudioRecord audioRecord, boolean verifyAudioConfig) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return 0;
        List<AudioRecordingConfiguration> configs = audioManager.getActiveRecordingConfigurations();
        Logging.d(TAG, "Active recording sessions: " + configs.size());
        if (verifyAudioConfig && audioRecord != null) {
            audioSourceMatchesRecordingSessionRef.set(verifyAudioConfig(
                audioRecord.getAudioSource(), audioRecord.getAudioSessionId(),
                audioRecord.getFormat(), audioRecord.getRoutedDevice(), configs));
        }
        return configs.size();
    }

    private boolean verifyAudioConfig(int source, int session, AudioFormat format,
            android.media.AudioDeviceInfo device, java.util.List<AudioRecordingConfiguration> configs) {
        for (AudioRecordingConfiguration config : configs) {
            if (config.getClientAudioSource() == source
                    && config.getClientAudioSessionId() == session
                    && config.getClientFormat().getEncoding() == format.getEncoding()
                    && config.getClientFormat().getSampleRate() == format.getSampleRate()
                    && config.getClientFormat().getChannelMask() == format.getChannelMask()) {
                return true;
            }
        }
        return false;
    }

    private int channelCountToConfiguration(int channels) {
        return (channels == 1 ? AudioFormat.CHANNEL_IN_MONO : AudioFormat.CHANNEL_IN_STEREO);
    }

    private void releaseAudioResources() {
        if (micRecord != null) {
            micRecord.release();
            micRecord = null;
        }
        if (playbackRecord != null) {
            playbackRecord.release();
            playbackRecord = null;
        }
    }

    private void reportInitError(String errorMessage) {
        Logging.e(TAG, "Init recording error: " + errorMessage);
        if (errorCallback != null) {
            errorCallback.onWebRtcAudioRecordInitError(errorMessage);
        }
    }

    private void reportStartError(int errorCode, String errorMessage) {
        Logging.e(TAG, "Start recording error: " + errorCode + ". " + errorMessage);
        if (errorCallback != null) {
            errorCallback.onWebRtcAudioRecordStartError(errorCode, errorMessage);
        }
    }

    private void reportError(String errorMessage) {
        Logging.e(TAG, "Run-time recording error: " + errorMessage);
        if (errorCallback != null) {
            errorCallback.onWebRtcAudioRecordError(errorMessage);
        }
    }

    private void doAudioRecordStateCallback(int audioState) {
        if (stateCallback != null) {
            if (audioState == AUDIO_RECORD_START) {
                stateCallback.onWebRtcAudioRecordStart();
            } else if (audioState == AUDIO_RECORD_STOP) {
                stateCallback.onWebRtcAudioRecordStop();
            }
        }
    }

    private native void nativeCacheDirectBufferAddress(long nativeAudioRecordJni, ByteBuffer byteBuffer);
    private native void nativeDataIsRecorded(long nativeAudioRecordJni, int bytes, long captureTimestampNs);
}