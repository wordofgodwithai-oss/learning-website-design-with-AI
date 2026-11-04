declare module "ffmpeg-static" {
  const binaryPath: string | null;
  export default binaryPath;
}

declare module "ffprobe-static" {
  const value: { path: string };
  export default value;
}
