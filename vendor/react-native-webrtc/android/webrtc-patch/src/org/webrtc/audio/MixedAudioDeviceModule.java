package org.webrtc.audio;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.projection.MediaProjection;
import android.os.Build;
import androidx.annotation.Nullable;
import androidx.annotation.RequiresApi;
import org.webrtc.JniCommon;
import org.webrtc.Logging;

public class MixedAudioDeviceModule implements AudioDeviceModule {
    private static final String TAG = "MixedAudioDeviceModule";

    public static Builder builder(Context context) {
        return new Builder(context);
    }

    public static class Builder {
        private final Context context;
        private ScheduledExecutorService scheduler;
        private final AudioManager audioManager;
        private int audioSource = WebRtcAudioRecord.DEFAULT_AUDIO_SOURCE;
        private int audioFormat = WebRtcAudioRecord.DEFAULT_AUDIO_FORMAT;
        private AudioTrackErrorCallback audioTrackErrorCallback;
        private AudioRecordErrorCallback audioRecordErrorCallback;
        private SamplesReadyCallback samplesReadyCallback;
        private AudioTrackStateCallback audioTrackStateCallback;
        private AudioRecordStateCallback audioRecordStateCallback;
        private boolean useHardwareAcousticEchoCanceler = isBuiltInAcousticEchoCancelerSupported();
        private boolean useHardwareNoiseSuppressor = isBuiltInNoiseSuppressorSupported();
        private AudioAttributes audioAttributes;
        private boolean useLowLatency;
        private boolean enableVolumeLogger = true;

        private Builder(Context context) {
            this.context = context;
            this.audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        }

        public Builder setScheduler(ScheduledExecutorService scheduler) {
            this.scheduler = scheduler;
            return this;
        }

        public Builder setAudioSource(int audioSource) {
            this.audioSource = audioSource;
            return this;
        }

        public Builder setAudioFormat(int audioFormat) {
            this.audioFormat = audioFormat;
            return this;
        }

        public Builder setAudioTrackErrorCallback(AudioTrackErrorCallback callback) {
            this.audioTrackErrorCallback = callback;
            return this;
        }

        public Builder setAudioRecordErrorCallback(AudioRecordErrorCallback callback) {
            this.audioRecordErrorCallback = callback;
            return this;
        }

        public Builder setSamplesReadyCallback(SamplesReadyCallback callback) {
            this.samplesReadyCallback = callback;
            return this;
        }

        public Builder setAudioTrackStateCallback(AudioTrackStateCallback callback) {
            this.audioTrackStateCallback = callback;
            return this;
        }

        public Builder setAudioRecordStateCallback(AudioRecordStateCallback callback) {
            this.audioRecordStateCallback = callback;
            return this;
        }

        public Builder setUseHardwareAcousticEchoCanceler(boolean enable) {
            if (enable && !isBuiltInAcousticEchoCancelerSupported()) {
                Logging.e(TAG, "HW AEC not supported");
                enable = false;
            }
            this.useHardwareAcousticEchoCanceler = enable;
            return this;
        }

        public Builder setUseHardwareNoiseSuppressor(boolean enable) {
            if (enable && !isBuiltInNoiseSuppressorSupported()) {
                Logging.e(TAG, "HW NS not supported");
                enable = false;
            }
            this.useHardwareNoiseSuppressor = enable;
            return this;
        }

        public Builder setAudioAttributes(AudioAttributes attributes) {
            this.audioAttributes = attributes;
            return this;
        }

        public Builder setUseLowLatency(boolean enable) {
            this.useLowLatency = enable;
            return this;
        }

        public Builder setEnableVolumeLogger(boolean enable) {
            this.enableVolumeLogger = enable;
            return this;
        }

        public MixedAudioDeviceModule createAudioDeviceModule() {
            Logging.d(TAG, "createAudioDeviceModule");
            if (useHardwareNoiseSuppressor) {
                Logging.d(TAG, "HW NS will be used.");
            } else {
                if (isBuiltInNoiseSuppressorSupported()) {
                    Logging.d(TAG, "Overriding default behavior; now using WebRTC NS!");
                }
                Logging.d(TAG, "HW NS will not be used.");
            }
            if (useHardwareAcousticEchoCanceler) {
                Logging.d(TAG, "HW AEC will be used.");
            } else {
                if (isBuiltInAcousticEchoCancelerSupported()) {
                    Logging.d(TAG, "Overriding default behavior; now using WebRTC AEC!");
                }
                Logging.d(TAG, "HW AEC will not be used.");
            }

            ScheduledExecutorService executor = this.scheduler;
            if (executor == null) {
                executor = WebRtcAudioRecord.newDefaultScheduler();
            }

            final MixedAudioRecord audioInput = new MixedAudioRecord(context, audioManager,
                audioRecordErrorCallback, audioRecordStateCallback,
                samplesReadyCallback, useHardwareAcousticEchoCanceler, useHardwareNoiseSuppressor);

            final WebRtcAudioTrack audioOutput = new WebRtcAudioTrack(context, audioManager,
                audioAttributes, audioTrackErrorCallback, audioTrackStateCallback,
                useLowLatency, enableVolumeLogger);

            return new MixedAudioDeviceModule(context, audioManager, audioInput, audioOutput);
        }
    }

    private static final int AUDIO_RECORD_START = 0;
    private static final int AUDIO_RECORD_STOP = 1;

    public enum AudioRecordStartErrorCode {
        AUDIO_RECORD_START_EXCEPTION,
        AUDIO_RECORD_START_STATE_MISMATCH,
    }

    public interface AudioRecordErrorCallback {
        void onWebRtcAudioRecordInitError(String errorMessage);
        void onWebRtcAudioRecordStartError(int errorCode, String errorMessage);
        void onWebRtcAudioRecordError(String errorMessage);
    }

    public interface AudioRecordStateCallback {
        void onWebRtcAudioRecordStart();
        void onWebRtcAudioRecordStop();
    }

    public static class AudioSamples {
        private final int audioFormat;
        private final int channelCount;
        private final int sampleRate;
        private final byte[] data;

        public AudioSamples(int audioFormat, int channelCount, int sampleRate, byte[] data) {
            this.audioFormat = audioFormat;
            this.channelCount = channelCount;
            this.sampleRate = sampleRate;
            this.data = data;
        }

        public int getAudioFormat() { return audioFormat; }
        public int getChannelCount() { return channelCount; }
        public int getSampleRate() { return sampleRate; }
        public byte[] getData() { return data; }
    }

    public interface SamplesReadyCallback {
        void onWebRtcAudioRecordSamplesReady(AudioSamples samples);
    }

    public enum AudioTrackStartErrorCode {
        AUDIO_TRACK_START_EXCEPTION,
        AUDIO_TRACK_START_STATE_MISMATCH,
    }

    public interface AudioTrackErrorCallback {
        void onWebRtcAudioTrackInitError(String errorMessage);
        void onWebRtcAudioTrackStartError(AudioTrackStartErrorCode errorCode, String errorMessage);
        void onWebRtcAudioTrackError(String errorMessage);
    }

    public interface AudioTrackStateCallback {
        void onWebRtcAudioTrackStart();
        void onWebRtcAudioTrackStop();
    }

    public static boolean isBuiltInAcousticEchoCancelerSupported() {
        return WebRtcAudioEffects.isAcousticEchoCancelerSupported();
    }

    public static boolean isBuiltInNoiseSuppressorSupported() {
        return WebRtcAudioEffects.isNoiseSuppressorSupported();
    }

    private final Context context;
    private final AudioManager audioManager;
    private final MixedAudioRecord audioInput;
    private final WebRtcAudioTrack audioOutput;

    private final Object nativeLock = new Object();
    private long nativeAudioDeviceModule;

    private MixedAudioDeviceModule(Context context, AudioManager audioManager,
                                    MixedAudioRecord audioInput, WebRtcAudioTrack audioOutput) {
        this.context = context;
        this.audioManager = audioManager;
        this.audioInput = audioInput;
        this.audioOutput = audioOutput;
    }

    @Override
    public long getNativeAudioDeviceModulePointer() {
        synchronized (nativeLock) {
            if (nativeAudioDeviceModule == 0) {
                nativeAudioDeviceModule = nativeCreateAudioDeviceModule(
                    context, audioManager, audioInput, audioOutput);
            }
            return nativeAudioDeviceModule;
        }
    }

    @Override
    public void release() {
        synchronized (nativeLock) {
            if (nativeAudioDeviceModule != 0) {
                JniCommon.nativeReleaseRef(nativeAudioDeviceModule);
                nativeAudioDeviceModule = 0;
            }
        }
    }

    @Override
    public void setSpeakerMute(boolean mute) {
        Logging.d(TAG, "setSpeakerMute: " + mute);
        audioOutput.setSpeakerMute(mute);
    }

    @Override
    public void setMicrophoneMute(boolean mute) {
        Logging.d(TAG, "setMicrophoneMute: " + mute);
        audioInput.setMicMute(mute);
    }

    public synchronized boolean setMediaProjection(@Nullable MediaProjection mediaProjection) {
        return audioInput.setMediaProjection(mediaProjection);
    }

    @Override
    public boolean setNoiseSuppressorEnabled(boolean enabled) {
        Logging.d(TAG, "setNoiseSuppressorEnabled: " + enabled);
        return audioInput.setNoiseSuppressorEnabled(enabled);
    }

    @RequiresApi(Build.VERSION_CODES.M)
    public void setPreferredInputDevice(android.media.AudioDeviceInfo preferredInputDevice) {
        Logging.d(TAG, "setPreferredInputDevice: " + preferredInputDevice);
    }

    private static native long nativeCreateAudioDeviceModule(Context context,
        AudioManager audioManager, MixedAudioRecord audioInput, WebRtcAudioTrack audioOutput);
}