// Точка входу COM-сервера: фабрика класів і реєстрація камери в системі.
//
// Реєструємось у HKCU\Software\Classes, а не в HKLM. Windows зводить ці гілки в
// HKEY_CLASSES_ROOT, тож камеру бачать усі застосунки поточного користувача, зате
// встановлення не потребує прав адміністратора.
#include <windows.h>
#include <dshow.h>
#include <olectl.h>

#include <atomic>
#include <string>

#include "filter.h"
#include "guids.h"

namespace {

HMODULE g_module = nullptr;

using memecam::Filter;
using memecam::g_object_count;
using memecam::kClsidString;
using memecam::kFilterClsid;
using memecam::kFilterName;

// Категорія пристроїв відеозахоплення — саме в ній застосунки шукають камери.
constexpr wchar_t kVideoInputCategory[] = L"{860BB310-5D01-11D0-BD3B-00A0C911CE86}";

class ClassFactory : public IClassFactory {
 public:
  ClassFactory() { ++g_object_count; }
  ~ClassFactory() { --g_object_count; }

  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_IClassFactory) {
      *ppv = static_cast<IClassFactory*>(this);
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return ++ref_; }
  STDMETHODIMP_(ULONG) Release() override {
    const ULONG n = --ref_;
    if (n == 0) delete this;
    return n;
  }

  STDMETHODIMP CreateInstance(IUnknown* outer, REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    *ppv = nullptr;
    if (outer) return CLASS_E_NOAGGREGATION;

    auto* filter = new (std::nothrow) Filter();
    if (!filter) return E_OUTOFMEMORY;

    const HRESULT hr = filter->QueryInterface(riid, ppv);
    filter->Release();
    return hr;
  }

  STDMETHODIMP LockServer(BOOL lock) override {
    if (lock) {
      ++g_object_count;
    } else {
      --g_object_count;
    }
    return S_OK;
  }

 private:
  std::atomic<ULONG> ref_{1};
};

/** Створює ключ у HKCU\Software\Classes і записує рядкове значення. */
LONG SetString(const std::wstring& subkey, const wchar_t* name, const std::wstring& value) {
  HKEY key = nullptr;
  const std::wstring path = L"Software\\Classes\\" + subkey;
  LONG r = RegCreateKeyExW(HKEY_CURRENT_USER, path.c_str(), 0, nullptr, REG_OPTION_NON_VOLATILE,
                           KEY_WRITE, nullptr, &key, nullptr);
  if (r != ERROR_SUCCESS) return r;

  r = RegSetValueExW(key, name, 0, REG_SZ, reinterpret_cast<const BYTE*>(value.c_str()),
                     static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t)));
  RegCloseKey(key);
  return r;
}

/** Рекурсивно видаляє гілку в HKCU\Software\Classes. */
void DeleteTree(const std::wstring& subkey) {
  const std::wstring path = L"Software\\Classes\\" + subkey;
  RegDeleteTreeW(HKEY_CURRENT_USER, path.c_str());
}

}  // namespace

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    g_module = instance;
    DisableThreadLibraryCalls(instance);
  }
  return TRUE;
}

STDAPI DllGetClassObject(REFCLSID clsid, REFIID riid, void** ppv) {
  if (!ppv) return E_POINTER;
  *ppv = nullptr;
  if (clsid != kFilterClsid) return CLASS_E_CLASSNOTAVAILABLE;

  auto* factory = new (std::nothrow) ClassFactory();
  if (!factory) return E_OUTOFMEMORY;

  const HRESULT hr = factory->QueryInterface(riid, ppv);
  factory->Release();
  return hr;
}

STDAPI DllCanUnloadNow() { return g_object_count == 0 ? S_OK : S_FALSE; }

STDAPI DllRegisterServer() {
  wchar_t path[MAX_PATH]{};
  if (!GetModuleFileNameW(g_module, path, MAX_PATH)) return SELFREG_E_CLASS;

  const std::wstring clsid_key = std::wstring(L"CLSID\\") + kClsidString;

  // 1. Сам COM-сервер.
  if (SetString(clsid_key, nullptr, kFilterName) != ERROR_SUCCESS) return SELFREG_E_CLASS;
  if (SetString(clsid_key + L"\\InprocServer32", nullptr, path) != ERROR_SUCCESS) {
    return SELFREG_E_CLASS;
  }
  // Both — щоб фільтр можна було створювати з будь-якої моделі потоків застосунку.
  if (SetString(clsid_key + L"\\InprocServer32", L"ThreadingModel", L"Both") != ERROR_SUCCESS) {
    return SELFREG_E_CLASS;
  }

  // 2. Запис у категорії пристроїв відеозахоплення. Саме звідси застосунки
  //    беруть назву й CLSID, коли перелічують камери.
  const std::wstring instance_key =
      std::wstring(L"CLSID\\") + kVideoInputCategory + L"\\Instance\\" + kClsidString;

  if (SetString(instance_key, L"CLSID", kClsidString) != ERROR_SUCCESS) return SELFREG_E_CLASS;
  if (SetString(instance_key, L"FriendlyName", kFilterName) != ERROR_SUCCESS) {
    return SELFREG_E_CLASS;
  }

  return S_OK;
}

STDAPI DllUnregisterServer() {
  DeleteTree(std::wstring(L"CLSID\\") + kVideoInputCategory + L"\\Instance\\" + kClsidString);
  DeleteTree(std::wstring(L"CLSID\\") + kClsidString);
  return S_OK;
}
