"""Generate the original geometric folder icon without external dependencies."""
import struct
import zlib
from pathlib import Path

def color(x, y):
    background = (48, 55, 23)
    if 46 <= x <= 210 and 78 <= y <= 190 or 46 <= x <= 116 and 56 <= y <= 84:
        if 76 <= x <= 180 and (113 <= y <= 122 or 148 <= y <= 157):
            return background
        return (244, 247, 229)
    return background

def chunk(name, data):
    return struct.pack('>I', len(data)) + name + data + struct.pack('>I', zlib.crc32(name + data))

pixels = b''.join(b'\0' + bytes(v for x in range(256) for v in color(x, y)) for y in range(256))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 256, 256, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')
Path('media/icon.png').write_bytes(png)
