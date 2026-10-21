declare module 'utif' {
  /** A TIFF Image File Directory. Tag values are stored under keys like `t256` (ImageWidth). */
  export interface IFD {
    [tag: string]: any
    width: number
    height: number
    data?: Uint8Array
  }

  export function decode(buffer: ArrayBuffer | Uint8Array): IFD[]
  export function decodeImage(buffer: ArrayBuffer | Uint8Array, ifd: IFD, ifds?: IFD[]): void
  export function toRGBA8(ifd: IFD): Uint8Array

  const UTIF: {
    decode: typeof decode
    decodeImage: typeof decodeImage
    toRGBA8: typeof toRGBA8
  }
  export default UTIF
}
