// Ідентифікатори нашого фільтра. CLSID згенеровано один раз і мінятися не має:
// саме за ним система знаходить камеру, і зміна зробить її новим пристроєм.
#pragma once

#include <windows.h>

namespace memecam {

// {D28DD6E3-627F-4C05-AC7F-513441A10980}
constexpr GUID kFilterClsid = {
    0xd28dd6e3, 0x627f, 0x4c05, {0xac, 0x7f, 0x51, 0x34, 0x41, 0xa1, 0x09, 0x80}};

constexpr wchar_t kFilterName[] = L"Meme Cam";
constexpr wchar_t kClsidString[] = L"{D28DD6E3-627F-4C05-AC7F-513441A10980}";

// MEDIASUBTYPE для NV12: FOURCC 'NV12' у стандартній обгортці підтипів DirectShow.
// Оголошуємо самі, щоб не залежати від наявності uuids.h у складі SDK.
constexpr GUID kMediaSubtypeNv12 = {
    0x3231564e, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}};

}  // namespace memecam
