declare module "libheif-js/wasm-bundle" {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(imageData: ImageData, cb: (result: ImageData | null) => void): void;
  }
  const libheif: {
    HeifDecoder: new () => { decode(buffer: ArrayBuffer): HeifImage[] };
  };
  export default libheif;
}
