"""Update only the icon resources of our copied unsigned Windows executable."""
import ctypes
import struct
import sys
from pathlib import Path

def apply(executable: Path, icon: Path):
    data = icon.read_bytes()
    reserved, kind, count = struct.unpack_from('<HHH', data)
    if reserved != 0 or kind != 1:
        raise ValueError('Invalid ICO')
    api = ctypes.WinDLL('kernel32', use_last_error=True)
    api.BeginUpdateResourceW.argtypes = [ctypes.c_wchar_p, ctypes.c_bool]
    api.BeginUpdateResourceW.restype = ctypes.c_void_p
    api.UpdateResourceW.argtypes = [ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_ushort,ctypes.c_void_p,ctypes.c_uint]
    api.UpdateResourceW.restype = ctypes.c_bool
    api.EndUpdateResourceW.argtypes = [ctypes.c_void_p,ctypes.c_bool]
    api.EndUpdateResourceW.restype = ctypes.c_bool
    handle = api.BeginUpdateResourceW(str(executable),False)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    success = False
    try:
        group = bytearray(struct.pack('<HHH',0,1,count))
        for index in range(count):
            entry = struct.unpack_from('<BBBBHHII',data,6+index*16)
            width,height,colors,pad,planes,bits,size,offset = entry
            blob = ctypes.create_string_buffer(data[offset:offset+size])
            resource_id = index + 1
            if not api.UpdateResourceW(handle,3,resource_id,1033,blob,size):
                raise ctypes.WinError(ctypes.get_last_error())
            group.extend(struct.pack('<BBBBHHIH',width,height,colors,pad,planes,bits,size,resource_id))
        blob = ctypes.create_string_buffer(bytes(group))
        if not api.UpdateResourceW(handle,14,1,1033,blob,len(group)):
            raise ctypes.WinError(ctypes.get_last_error())
        success = True
    finally:
        if not api.EndUpdateResourceW(handle,not success):
            raise ctypes.WinError(ctypes.get_last_error())
    print('Embedded Murmur application icon.')

if __name__ == '__main__':
    apply(Path(sys.argv[1]).resolve(),Path(sys.argv[2]).resolve())
