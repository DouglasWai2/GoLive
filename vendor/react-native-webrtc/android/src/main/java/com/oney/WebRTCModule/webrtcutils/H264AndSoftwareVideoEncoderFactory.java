package com.oney.WebRTCModule.webrtcutils;

import androidx.annotation.Nullable;

import org.webrtc.EglBase;
import org.webrtc.HardwareVideoEncoderFactory;
import org.webrtc.VideoCodecInfo;
import org.webrtc.VideoEncoder;
import org.webrtc.VideoEncoderFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * This is a custom video encoder factory for WebRTC which behaves similarly
 * to the default one in iOS. It supports the following codecs:
 *
 * - In hardware: H.264 (high, baseline), plus VP8, VP9 and AV1 when available
 * - In software: codecs for which the device exposes no hardware encoder
 */
public class H264AndSoftwareVideoEncoderFactory implements VideoEncoderFactory {
    private final VideoEncoderFactory hardwareVideoEncoderFactory;
    private final VideoEncoderFactory softwareVideoEncoderFactory;

    public H264AndSoftwareVideoEncoderFactory(@Nullable EglBase.Context eglContext) {
        this.hardwareVideoEncoderFactory = new HardwareVideoEncoderFactory(eglContext, false, true);
        this.softwareVideoEncoderFactory = new SoftwareVideoEncoderFactoryProxy();
    }

    @Nullable
    @Override
    public VideoEncoder createEncoder(VideoCodecInfo codecInfo) {
        for (VideoCodecInfo hardwareCodec : this.hardwareVideoEncoderFactory.getSupportedCodecs()) {
            if (hardwareCodec.name.equalsIgnoreCase(codecInfo.name)) {
                VideoEncoder encoder = this.hardwareVideoEncoderFactory.createEncoder(codecInfo);
                if (encoder != null) {
                    return encoder;
                }
                break;
            }
        }

        return this.softwareVideoEncoderFactory.createEncoder(codecInfo);
    }

    public String[] getHardwareCodecNames() {
        List<String> names = new ArrayList<>();
        for (VideoCodecInfo codec : hardwareVideoEncoderFactory.getSupportedCodecs()) {
            String name = codec.name.toUpperCase(Locale.ROOT);
            if (!names.contains(name)) {
                names.add(name);
            }
        }
        return names.toArray(new String[0]);
    }

    @Override
    public VideoCodecInfo[] getSupportedCodecs() {
        List<VideoCodecInfo> codecs = new ArrayList<>();

        VideoCodecInfo h264Baseline = null;
        VideoCodecInfo h264High = null;

        VideoCodecInfo[] hwCodecs = this.hardwareVideoEncoderFactory.getSupportedCodecs();
        for (VideoCodecInfo hwCodec : hwCodecs) {
            if (hwCodec.name.equalsIgnoreCase("H264")) {
                String profileLevel = hwCodec.params.get(VideoCodecInfo.H264_FMTP_PROFILE_LEVEL_ID);
                if (profileLevel == null) {
                    continue;
                }
                if (profileLevel.equalsIgnoreCase(VideoCodecInfo.H264_CONSTRAINED_HIGH_3_1)) {
                    h264High = hwCodec;
                } else if (profileLevel.equalsIgnoreCase(VideoCodecInfo.H264_CONSTRAINED_BASELINE_3_1)) {
                    h264Baseline = hwCodec;
                }
            }
        }

        if (h264High != null) {
            codecs.add(h264High);
        }
        if (h264Baseline != null) {
            codecs.add(h264Baseline);
        }

        for (VideoCodecInfo hwCodec : hwCodecs) {
            if (!hwCodec.name.equalsIgnoreCase("H264")) {
                codecs.add(hwCodec);
            }
        }

        for (VideoCodecInfo softwareCodec : this.softwareVideoEncoderFactory.getSupportedCodecs()) {
            boolean hardwareAvailable = false;
            for (VideoCodecInfo hwCodec : hwCodecs) {
                if (hwCodec.name.equalsIgnoreCase(softwareCodec.name)) {
                    hardwareAvailable = true;
                    break;
                }
            }
            if (!hardwareAvailable) {
                codecs.add(softwareCodec);
            }
        }

        return codecs.toArray(new VideoCodecInfo[codecs.size()]);
    }
}
