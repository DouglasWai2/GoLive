import MediaStream from './MediaStream';
export interface Constraints {
    audio?: boolean;
    android?: {
        createConfigForDefaultDisplay?: boolean;
        resolutionScale?: number;
    };
}
export default function getDisplayMedia(constraints?: Constraints): Promise<MediaStream>;
