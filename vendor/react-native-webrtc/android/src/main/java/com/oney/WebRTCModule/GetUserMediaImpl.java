package com.oney.WebRTCModule;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.media.projection.MediaProjectionConfig;
import android.util.DisplayMetrics;
import android.util.Log;
import android.os.Build;

import androidx.core.util.Consumer;
import androidx.core.content.ContextCompat;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Callback;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReadableType;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.oney.WebRTCModule.videoEffects.ProcessorProvider;
import com.oney.WebRTCModule.videoEffects.VideoEffectProcessor;
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessor;

import org.webrtc.*;
import org.webrtc.audio.JavaAudioDeviceModule;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * The implementation of {@code getUserMedia} extracted into a separate file in
 * order to reduce complexity and to (somewhat) separate concerns.
 */
class GetUserMediaImpl {
    /**
     * The {@link Log} tag with which {@code GetUserMediaImpl} is to log.
     */
    private static final String TAG = WebRTCModule.TAG;

    private static final int PERMISSION_REQUEST_CODE = (int) (Math.random() * Short.MAX_VALUE);

    private CameraEnumerator cameraEnumerator;
    private final ReactApplicationContext reactContext;

    /**
     * The application/library-specific private members of local
     * {@link MediaStreamTrack}s created by {@code GetUserMediaImpl} mapped by
     * track ID.
     */
    private final Map<String, TrackPrivate> tracks = new HashMap<>();

    private final WebRTCModule webRTCModule;

    private Promise displayMediaPromise;
    private Intent mediaProjectionPermissionResultData;
    private boolean createConfigForDefaultDisplay = false;
    private boolean displayAudioRequested = false;
    private volatile boolean displayAudioCaptureConfigured = false;
    private float resolutionScale = 1.0f;

    GetUserMediaImpl(WebRTCModule webRTCModule, ReactApplicationContext reactContext) {
        this.webRTCModule = webRTCModule;
        this.reactContext = reactContext;

        reactContext.addActivityEventListener(new BaseActivityEventListener() {
            @Override
            public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
                super.onActivityResult(activity, requestCode, resultCode, data);
                if (requestCode == PERMISSION_REQUEST_CODE) {
                    if (resultCode != Activity.RESULT_OK) {
                        displayMediaPromise.reject("DOMException", "NotAllowedError");
                        displayMediaPromise = null;
                        return;
                    }

                    mediaProjectionPermissionResultData = data;

                    MediaProjectionService.launch(activity)
                        .orTimeout(10, TimeUnit.SECONDS)
                        .whenCompleteAsync((value, error) -> {
                            if (error != null) {
                                Log.e(TAG, "Failed to start MediaProjection service", error);
                                MediaProjectionService.abort(activity);
                                displayMediaPromise.reject("DOMException", "AbortError");
                                displayMediaPromise = null;
                                mediaProjectionPermissionResultData = null;
                                return;
                            }

                            createScreenStream();
                        }, ThreadUtils.getExecutor());
                }
            }
        });
    }

    private AudioTrack createAudioTrack(ReadableMap constraints) {
        if (displayAudioCaptureConfigured) {
            throw new IllegalStateException(
                    "Microphone capture is unavailable while display audio is active.");
        }

        ReadableMap audioConstraintsMap = constraints.getMap("audio");

        Log.d(TAG, "getUserMedia(audio): " + audioConstraintsMap);

        String id = UUID.randomUUID().toString();
        PeerConnectionFactory pcFactory = webRTCModule.mFactory;
        MediaConstraints peerConstraints = webRTCModule.constraintsForOptions(audioConstraintsMap);

        // PeerConnectionFactory.createAudioSource will throw an error when mandatory constraints contain nulls.
        // so, let's check for nulls
        checkMandatoryConstraints(peerConstraints);

        AudioSource audioSource = pcFactory.createAudioSource(peerConstraints);
        AudioTrack track = pcFactory.createAudioTrack(id, audioSource);

        // surfaceTextureHelper is initialized for videoTrack only, so its null here.
        tracks.put(id, new TrackPrivate(track, audioSource, /* videoCapturer */ null, /* surfaceTextureHelper */ null));

        return track;
    }

    private void checkMandatoryConstraints(MediaConstraints peerConstraints) {
        ArrayList<MediaConstraints.KeyValuePair> valid = new ArrayList<>(peerConstraints.mandatory.size());

        for (MediaConstraints.KeyValuePair constraint : peerConstraints.mandatory) {
            if (constraint.getValue() != null) {
                valid.add(constraint);
            } else {
                Log.d(TAG, String.format("constraint %s is null, ignoring it", constraint.getKey()));
            }
        }

        peerConstraints.mandatory.clear();
        peerConstraints.mandatory.addAll(valid);
    }

    private CameraEnumerator getCameraEnumerator() {
        if (cameraEnumerator == null) {
            if (Camera2Enumerator.isSupported(reactContext)) {
                Log.d(TAG, "Creating camera enumerator using the Camera2 API");
                cameraEnumerator = new Camera2Enumerator(reactContext);
            } else {
                Log.d(TAG, "Creating camera enumerator using the Camera1 API");
                cameraEnumerator = new Camera1Enumerator(false);
            }
        }

        return cameraEnumerator;
    }

    ReadableArray enumerateDevices() {
        WritableArray array = Arguments.createArray();
        String[] devices = getCameraEnumerator().getDeviceNames();

        for (int i = 0; i < devices.length; ++i) {
            String deviceName = devices[i];
            boolean isFrontFacing;
            try {
                // This can throw an exception when using the Camera 1 API.
                isFrontFacing = getCameraEnumerator().isFrontFacing(deviceName);
            } catch (Exception e) {
                Log.e(TAG, "Failed to check the facing mode of camera");
                continue;
            }
            WritableMap params = Arguments.createMap();
            params.putString("facing", isFrontFacing ? "front" : "environment");
            params.putString("deviceId", "" + i);
            params.putString("groupId", "");
            params.putString("label", deviceName);
            params.putString("kind", "videoinput");
            array.pushMap(params);
        }

        WritableMap audio = Arguments.createMap();
        audio.putString("deviceId", "audio-1");
        audio.putString("groupId", "");
        audio.putString("label", "Audio");
        audio.putString("kind", "audioinput");
        array.pushMap(audio);

        return array;
    }

    MediaStreamTrack getTrack(String id) {
        TrackPrivate private_ = tracks.get(id);

        return private_ == null ? null : private_.track;
    }

    /**
     * Implements {@code getUserMedia}. Note that at this point constraints have
     * been normalized and permissions have been granted. The constraints only
     * contain keys for which permissions have already been granted, that is,
     * if audio permission was not granted, there will be no "audio" key in
     * the constraints map.
     */
    void getUserMedia(final ReadableMap constraints, final Callback successCallback, final Callback errorCallback) {
        AudioTrack audioTrack = null;
        VideoTrack videoTrack = null;

        if (constraints.hasKey("audio")) {
            audioTrack = createAudioTrack(constraints);
        }

        if (constraints.hasKey("video")) {
            ReadableMap videoConstraintsMap = constraints.getMap("video");

            Log.d(TAG, "getUserMedia(video): " + videoConstraintsMap);

            Activity currentActivity = this.reactContext.getCurrentActivity();
            if (currentActivity == null) {
                errorCallback.invoke("Error", "No current Activity.");
                return;
            }

            CameraCaptureController cameraCaptureController = new CameraCaptureController(
                    currentActivity, getCameraEnumerator(), videoConstraintsMap);

            videoTrack = createVideoTrack(cameraCaptureController);
        }

        if (audioTrack == null && videoTrack == null) {
            // Fail with DOMException with name AbortError as per:
            // https://www.w3.org/TR/mediacapture-streams/#dom-mediadevices-getusermedia
            errorCallback.invoke("DOMException", "AbortError");
            return;
        }

        createStream(new MediaStreamTrack[] {audioTrack, videoTrack}, (streamId, tracksInfo) -> {
            WritableArray tracksInfoWritableArray = Arguments.createArray();

            for (WritableMap trackInfo : tracksInfo) {
                tracksInfoWritableArray.pushMap(trackInfo);
            }

            successCallback.invoke(streamId, tracksInfoWritableArray);
        });
    }

    void mediaStreamTrackSetEnabled(String trackId, final boolean enabled) {
        TrackPrivate track = tracks.get(trackId);
        if (track != null && track.videoCaptureController != null) {
            if (enabled) {
                track.videoCaptureController.startCapture();
            } else {
                track.videoCaptureController.stopCapture();
            }
        }
    }

    void disposeTrack(String id) {
        TrackPrivate track = tracks.remove(id);
        if (track != null) {
            track.dispose();
        }
    }

    void applyConstraints(String trackId, ReadableMap constraints, Promise promise) {
        TrackPrivate track = tracks.get(trackId);
        if (track != null && track.videoCaptureController instanceof AbstractVideoCaptureController) {
            AbstractVideoCaptureController captureController =
                    (AbstractVideoCaptureController) track.videoCaptureController;
            captureController.applyConstraints(constraints, new Consumer<Exception>() {
                public void accept(Exception e) {
                    if (e != null) {
                        promise.reject(e);
                        return;
                    }

                    promise.resolve(captureController.getSettings());
                }
            });
        } else {
            promise.reject(new Exception("Camera track not found!"));
        }
    }

    void initializeConstraints(ReadableMap constraints) {

        // Handle the incoming params

        ReadableMap androidConstraints = null;
        if (constraints.hasKey("android") && constraints.getType("android") == ReadableType.Map) {
            androidConstraints = constraints.getMap("android");
        }

        // Default values
        boolean createConfigForDefaultDisplay = false;
        boolean displayAudioRequested = false;
        float scale = 1.0f;

        if (constraints.hasKey("audio") && constraints.getType("audio") == ReadableType.Boolean) {
            displayAudioRequested = constraints.getBoolean("audio");
        }

        if (androidConstraints != null) {
            // MediaProjectionConfig need API level 34
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
                && androidConstraints.hasKey("createConfigForDefaultDisplay")
                && androidConstraints.getType("createConfigForDefaultDisplay") == ReadableType.Boolean) {
                createConfigForDefaultDisplay = androidConstraints.getBoolean("createConfigForDefaultDisplay");
            }
            if (androidConstraints.hasKey("resolutionScale")
                && androidConstraints.getType("resolutionScale") == ReadableType.Number) {
                scale = (float) androidConstraints.getDouble("resolutionScale");
            }
        }

        this.createConfigForDefaultDisplay = createConfigForDefaultDisplay;
        this.displayAudioRequested = displayAudioRequested && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
        // Force the value in [0, 1]
        this.resolutionScale = Math.max(0.0f, Math.min(1.0f, scale));

        Log.d(TAG, "initializeConstraints: createConfigForDefaultDisplay=" + this.createConfigForDefaultDisplay
            + " displayAudioRequested=" + this.displayAudioRequested
            + " resolutionScale=" + this.resolutionScale);
    }

    void getDisplayMedia(final ReadableMap constraints, Promise promise) {
        if (this.displayMediaPromise != null) {
            promise.reject(new RuntimeException("Another operation is pending."));
            return;
        }

        Activity currentActivity = this.reactContext.getCurrentActivity();
        if (currentActivity == null) {
            promise.reject(new RuntimeException("No current Activity."));
            return;
        }

        this.initializeConstraints(constraints);

        if (displayAudioRequested
                && ContextCompat.checkSelfPermission(reactContext, Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
            promise.reject("NotAllowedError", "Audio playback capture permission was not granted.");
            return;
        }

        this.displayMediaPromise = promise;

        MediaProjectionManager mediaProjectionManager =
                (MediaProjectionManager) currentActivity.getApplication().getSystemService(
                        Context.MEDIA_PROJECTION_SERVICE);

        if (mediaProjectionManager != null) {
            UiThreadUtil.runOnUiThread(new Runnable() {
                @Override
                public void run() {

                  if (createConfigForDefaultDisplay == true) {
                        //MediaProjectionConfig need API level 34
                        //Return mediaProjection which restricts the user to capturing the default display
                        currentActivity.startActivityForResult(
                            createScreenCaptureIntent(mediaProjectionManager), PERMISSION_REQUEST_CODE);
                    } else {
                        //Return mediaProjection which allows the user to decide which region is captured
                        currentActivity.startActivityForResult(
                            mediaProjectionManager.createScreenCaptureIntent(), PERMISSION_REQUEST_CODE);
                    }
                }
            });

        } else {
            promise.reject(new RuntimeException("MediaProjectionManager is null."));
            this.displayMediaPromise = null;
        }
    }

    private Intent createScreenCaptureIntent(MediaProjectionManager mediaProjectionManager) {
        if (displayAudioRequested && Build.VERSION.SDK_INT >= 37) {
            try {
                Class<?> builderClass = Class.forName(
                        "android.media.projection.MediaProjectionConfig$Builder");
                Object builder = builderClass.getConstructor().newInstance();
                builderClass.getMethod("setSourceEnabled", int.class, boolean.class)
                        .invoke(builder, 1 << 1, true);
                builderClass.getMethod("setAudioRequested", boolean.class)
                        .invoke(builder, true);
                MediaProjectionConfig config = (MediaProjectionConfig) builderClass
                        .getMethod("build")
                        .invoke(builder);
                return mediaProjectionManager.createScreenCaptureIntent(config);
            } catch (ReflectiveOperationException | RuntimeException error) {
                Log.w(TAG, "Audio-aware MediaProjectionConfig is unavailable; using legacy config.");
            }
        }

        return mediaProjectionManager.createScreenCaptureIntent(
                MediaProjectionConfig.createConfigForDefaultDisplay());
    }

    private void createScreenStream() {
        VideoTrack videoTrack = null;

        try {
            videoTrack = createScreenTrack();

            if (videoTrack == null) {
                throw new RuntimeException("ScreenTrack is null.");
            }

            AudioTrack audioTrack = null;

            if (displayAudioRequested) {
                try {
                    TrackPrivate videoPrivate = tracks.get(videoTrack.id());
                    if (videoPrivate == null
                            || !(videoPrivate.videoCaptureController instanceof ScreenCaptureController)) {
                        throw new RuntimeException("Screen capture controller is unavailable.");
                    }

                    MediaProjection mediaProjection =
                            ((ScreenCaptureController) videoPrivate.videoCaptureController)
                                    .getMediaProjection();
                    if (mediaProjection == null) {
                        throw new RuntimeException("MediaProjection is unavailable for audio capture.");
                    }
                    if (!(webRTCModule.mAudioDeviceModule instanceof JavaAudioDeviceModule)
                            || !((JavaAudioDeviceModule) webRTCModule.mAudioDeviceModule)
                                    .setAudioPlaybackCaptureMediaProjection(mediaProjection)) {
                        throw new RuntimeException(
                                "WebRTC audio input could not enable playback capture.");
                    }

                    displayAudioCaptureConfigured = true;
                    videoPrivate.setDisposeCallback(this::disableDisplayAudioCapture);
                    audioTrack = createDisplayAudioTrack();
                } catch (RuntimeException audioError) {
                    Log.e(TAG, "Display audio is unavailable; continuing with video only.",
                            audioError);
                    disableDisplayAudioCapture();
                }
            }

            MediaStreamTrack[] streamTracks = audioTrack == null
                    ? new MediaStreamTrack[] {videoTrack}
                    : new MediaStreamTrack[] {videoTrack, audioTrack};

            createStream(streamTracks, (streamId, tracksInfo) -> {
                WritableMap data = Arguments.createMap();

                data.putString("streamId", streamId);

                if (tracksInfo.size() == 0) {
                    displayMediaPromise.reject(new RuntimeException("No ScreenTrackInfo found."));
                } else {
                    data.putMap("track", tracksInfo.get(0));
                    if (tracksInfo.size() > 1) {
                        data.putMap("audioTrack", tracksInfo.get(1));
                    }
                    displayMediaPromise.resolve(data);
                }
            });
        } catch (RuntimeException error) {
            disableDisplayAudioCapture();
            if (videoTrack != null) {
                disposeTrack(videoTrack.id());
            } else {
                MediaProjectionService.abort(reactContext);
            }
            displayMediaPromise.reject("AbortError", error.getMessage(), error);
        } finally {
            mediaProjectionPermissionResultData = null;
            displayMediaPromise = null;
        }
    }

    private AudioTrack createDisplayAudioTrack() {
        String id = UUID.randomUUID().toString();
        MediaConstraints constraints = new MediaConstraints();
        constraints.optional.add(new MediaConstraints.KeyValuePair("googEchoCancellation", "false"));
        constraints.optional.add(new MediaConstraints.KeyValuePair("googAutoGainControl", "false"));
        constraints.optional.add(new MediaConstraints.KeyValuePair("googNoiseSuppression", "false"));
        constraints.optional.add(new MediaConstraints.KeyValuePair("googHighpassFilter", "false"));

        AudioSource audioSource = null;

        try {
            audioSource = webRTCModule.mFactory.createAudioSource(constraints);
            AudioTrack track = webRTCModule.mFactory.createAudioTrack(id, audioSource);
            TrackPrivate trackPrivate = new TrackPrivate(
                    track, audioSource, null, null);
            trackPrivate.setDisposeCallback(this::disableDisplayAudioCapture);
            tracks.put(id, trackPrivate);
            return track;
        } catch (RuntimeException error) {
            if (audioSource != null) {
                audioSource.dispose();
            }
            throw error;
        }
    }

    private void disableDisplayAudioCapture() {
        if (webRTCModule.mAudioDeviceModule instanceof JavaAudioDeviceModule) {
            ((JavaAudioDeviceModule) webRTCModule.mAudioDeviceModule)
                    .setAudioPlaybackCaptureMediaProjection(null);
        }
        displayAudioCaptureConfigured = false;
    }

    void createStream(MediaStreamTrack[] tracks, BiConsumer<String, ArrayList<WritableMap>> successCallback) {
        String streamId = UUID.randomUUID().toString();
        MediaStream mediaStream = webRTCModule.mFactory.createLocalMediaStream(streamId);

        ArrayList<WritableMap> tracksInfo = new ArrayList<>();

        for (MediaStreamTrack track : tracks) {
            if (track == null) {
                continue;
            }

            if (track instanceof AudioTrack) {
                mediaStream.addTrack((AudioTrack) track);
            } else {
                mediaStream.addTrack((VideoTrack) track);
            }

            WritableMap trackInfo = Arguments.createMap();
            String trackId = track.id();

            trackInfo.putBoolean("enabled", track.enabled());
            trackInfo.putString("id", trackId);
            trackInfo.putString("kind", track.kind());
            trackInfo.putString("readyState", "live");
            trackInfo.putBoolean("remote", false);

            if (track instanceof VideoTrack) {
                TrackPrivate tp = this.tracks.get(trackId);
                AbstractVideoCaptureController vcc = tp.videoCaptureController;
                trackInfo.putMap("settings", vcc.getSettings());
            }

            if (track instanceof AudioTrack) {
                WritableMap settings = Arguments.createMap();
                settings.putString("deviceId", "audio-1");
                settings.putString("groupId", "");
                trackInfo.putMap("settings", settings);
            }

            tracksInfo.add(trackInfo);
        }

        Log.d(TAG, "MediaStream id: " + streamId);
        webRTCModule.localStreams.put(streamId, mediaStream);

        successCallback.accept(streamId, tracksInfo);
    }

    private VideoTrack createScreenTrack() {
        DisplayMetrics displayMetrics = DisplayUtils.getDisplayMetrics(reactContext.getCurrentActivity());
        int width = displayMetrics.widthPixels;
        int height = displayMetrics.heightPixels;
        ScreenCaptureController screenCaptureController = new ScreenCaptureController(
                reactContext.getCurrentActivity(), width, height, mediaProjectionPermissionResultData,
                resolutionScale, this::disableDisplayAudioCapture);
        return createVideoTrack(screenCaptureController);
    }

    VideoTrack createVideoTrack(AbstractVideoCaptureController videoCaptureController) {
        videoCaptureController.initializeVideoCapturer();

        VideoCapturer videoCapturer = videoCaptureController.videoCapturer;
        if (videoCapturer == null) {
            return null;
        }

        PeerConnectionFactory pcFactory = webRTCModule.mFactory;
        EglBase.Context eglContext = EglUtils.getRootEglBaseContext();
        SurfaceTextureHelper surfaceTextureHelper = SurfaceTextureHelper.create("CaptureThread", eglContext);

        if (surfaceTextureHelper == null) {
            Log.d(TAG, "Error creating SurfaceTextureHelper");
            return null;
        }

        String id = UUID.randomUUID().toString();

        TrackCapturerEventsEmitter eventsEmitter = new TrackCapturerEventsEmitter(webRTCModule, id);
        videoCaptureController.setCapturerEventsListener(eventsEmitter);

        VideoSource videoSource = pcFactory.createVideoSource(videoCapturer.isScreencast());
        videoCapturer.initialize(surfaceTextureHelper, reactContext, videoSource.getCapturerObserver());

        VideoTrack track = pcFactory.createVideoTrack(id, videoSource);

        track.setEnabled(true);
        tracks.put(id, new TrackPrivate(track, videoSource, videoCaptureController, surfaceTextureHelper));

        videoCaptureController.startCapture();

        return track;
    }

    /**
     * Set video effects to the TrackPrivate corresponding to the trackId with the help of VideoEffectProcessor
     * corresponding to the names.
     * @param trackId TrackPrivate id
     * @param names VideoEffectProcessor names
     */
    void setVideoEffects(String trackId, ReadableArray names) {
        TrackPrivate track = tracks.get(trackId);

        if (track != null && track.videoCaptureController instanceof CameraCaptureController) {
            VideoSource videoSource = (VideoSource) track.mediaSource;
            SurfaceTextureHelper surfaceTextureHelper = track.surfaceTextureHelper;

            if (names != null) {
                List<VideoFrameProcessor> processors =
                        names.toArrayList()
                                .stream()
                                .filter(name -> name instanceof String)
                                .map(name -> {
                                    VideoFrameProcessor videoFrameProcessor =
                                            ProcessorProvider.getProcessor((String) name);
                                    if (videoFrameProcessor == null) {
                                        Log.e(TAG, "no videoFrameProcessor associated with this name: " + name);
                                    }
                                    return videoFrameProcessor;
                                })
                                .filter(Objects::nonNull)
                                .collect(Collectors.toList());

                VideoEffectProcessor videoEffectProcessor = new VideoEffectProcessor(processors, surfaceTextureHelper);
                videoSource.setVideoProcessor(videoEffectProcessor);

            } else {
                videoSource.setVideoProcessor(null);
            }
        }
    }

    /**
     * Application/library-specific private members of local
     * {@code MediaStreamTrack}s created by {@code GetUserMediaImpl}.
     */
    private static class TrackPrivate {
        /**
         * The {@code MediaSource} from which {@link #track} was created.
         */
        public final MediaSource mediaSource;

        public final MediaStreamTrack track;

        /**
         * The {@code VideoCapturer} from which {@link #mediaSource} was created
         * if {@link #track} is a {@link VideoTrack}.
         */
        public final AbstractVideoCaptureController videoCaptureController;

        private final SurfaceTextureHelper surfaceTextureHelper;

        /**
         * Whether this object has been disposed or not.
         */
        private boolean disposed;
        private Runnable disposeCallback;

        /**
         * Initializes a new {@code TrackPrivate} instance.
         *
         * @param track
         * @param mediaSource            the {@code MediaSource} from which the specified
         *                               {@code code} was created
         * @param videoCaptureController the {@code AbstractVideoCaptureController} from which the
         *                               specified {@code mediaSource} was created if the specified
         *                               {@code track} is a {@link VideoTrack}
         */
        public TrackPrivate(MediaStreamTrack track, MediaSource mediaSource,
                AbstractVideoCaptureController videoCaptureController, SurfaceTextureHelper surfaceTextureHelper) {
            this.track = track;
            this.mediaSource = mediaSource;
            this.videoCaptureController = videoCaptureController;
            this.surfaceTextureHelper = surfaceTextureHelper;
            this.disposed = false;
        }

        public void setDisposeCallback(Runnable disposeCallback) {
            this.disposeCallback = disposeCallback;
        }

        public void dispose() {
            if (!disposed) {
                if (videoCaptureController != null) {
                    videoCaptureController.stopCapture();
                    videoCaptureController.dispose();
                }

                /*
                 * As per webrtc library documentation - The caller still has ownership of {@code
                 * surfaceTextureHelper} and is responsible for making sure surfaceTextureHelper.dispose() is
                 * called. This also means that the caller can reuse the SurfaceTextureHelper to initialize a new
                 * VideoCapturer once the previous VideoCapturer has been disposed. */

                if (surfaceTextureHelper != null) {
                    surfaceTextureHelper.stopListening();
                    surfaceTextureHelper.dispose();
                }

                mediaSource.dispose();
                track.dispose();
                if (disposeCallback != null) {
                    disposeCallback.run();
                }
                disposed = true;
            }
        }
    }

    public interface BiConsumer<T, U> {
        void accept(T t, U u);
    }
}
