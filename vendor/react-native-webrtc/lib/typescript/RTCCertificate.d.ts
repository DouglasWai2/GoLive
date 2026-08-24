export declare type RTCCertificateFingerprint = {
    algorithm: string;
    value: string;
};
export default class RTCCertificate {
    _expires: number;
    _fingerprints: RTCCertificateFingerprint[];
    _id: string;
    constructor(info: {
        certificateId: string;
        expires: number;
        fingerprints: RTCCertificateFingerprint[];
    });
    get expires(): number;
    getFingerprints(): RTCCertificateFingerprint[];
}
