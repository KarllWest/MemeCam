// DirectShow source filter, що показує додаток як окрему камеру в системі.
//
// Написано без DirectShow BaseClasses: їх прибрали з сучасного Windows SDK,
// а тягнути окремі вихідники заради кількох класів не варто. Тут реалізовано
// рівно ті інтерфейси, які питають застосунки для захоплення відео.
#pragma once

#include <dshow.h>

#include <atomic>
#include <thread>
#include <vector>

#include "queue.h"

namespace memecam {

class Filter;

/** Єдиний вихідний пін фільтра: віддає кадри NV12. */
class Pin : public IPin, public IAMStreamConfig, public IKsPropertySet, public IQualityControl {
 public:
  explicit Pin(Filter* filter);
  ~Pin();

  // Час життя спільний з фільтром, тож лічильник посилань делегуємо йому.
  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override;
  STDMETHODIMP_(ULONG) AddRef() override;
  STDMETHODIMP_(ULONG) Release() override;

  // IPin
  STDMETHODIMP Connect(IPin* receive, const AM_MEDIA_TYPE* mt) override;
  STDMETHODIMP ReceiveConnection(IPin* connector, const AM_MEDIA_TYPE* mt) override;
  STDMETHODIMP Disconnect() override;
  STDMETHODIMP ConnectedTo(IPin** pin) override;
  STDMETHODIMP ConnectionMediaType(AM_MEDIA_TYPE* mt) override;
  STDMETHODIMP QueryPinInfo(PIN_INFO* info) override;
  STDMETHODIMP QueryDirection(PIN_DIRECTION* dir) override;
  STDMETHODIMP QueryId(LPWSTR* id) override;
  STDMETHODIMP QueryAccept(const AM_MEDIA_TYPE* mt) override;
  STDMETHODIMP EnumMediaTypes(IEnumMediaTypes** enumerator) override;
  STDMETHODIMP QueryInternalConnections(IPin** pins, ULONG* count) override;
  STDMETHODIMP EndOfStream() override;
  STDMETHODIMP BeginFlush() override;
  STDMETHODIMP EndFlush() override;
  STDMETHODIMP NewSegment(REFERENCE_TIME start, REFERENCE_TIME stop, double rate) override;

  // IAMStreamConfig — через нього застосунки дізнаються й обирають формат
  STDMETHODIMP SetFormat(AM_MEDIA_TYPE* mt) override;
  STDMETHODIMP GetFormat(AM_MEDIA_TYPE** mt) override;
  STDMETHODIMP GetNumberOfCapabilities(int* count, int* size) override;
  STDMETHODIMP GetStreamCaps(int index, AM_MEDIA_TYPE** mt, BYTE* caps) override;

  // IKsPropertySet — саме тут пін повідомляє, що він захоплювальний
  STDMETHODIMP Set(REFGUID set, DWORD id, void* instance, DWORD instance_size, void* data,
                   DWORD data_size) override;
  STDMETHODIMP Get(REFGUID set, DWORD id, void* instance, DWORD instance_size, void* data,
                   DWORD data_size, DWORD* returned) override;
  STDMETHODIMP QuerySupported(REFGUID set, DWORD id, DWORD* support) override;

  // IQualityControl
  STDMETHODIMP Notify(IBaseFilter* self, Quality q) override;
  STDMETHODIMP SetSink(IQualityControl* sink) override;

  HRESULT StartStreaming();
  void StopStreaming();
  bool IsConnected() const { return connected_ != nullptr; }

 private:
  void ThreadProc();
  void FillBlack(uint8_t* dst, uint32_t size) const;

  Filter* filter_;
  IPin* connected_ = nullptr;
  IMemInputPin* input_ = nullptr;
  IMemAllocator* allocator_ = nullptr;

  uint32_t width_ = kDefaultWidth;
  uint32_t height_ = kDefaultHeight;
  REFERENCE_TIME interval_ = kDefaultInterval;

  std::thread thread_;
  std::atomic<bool> running_{false};
  QueueReader queue_;
};

/** Сам фільтр. Пін у нього рівно один. */
class Filter : public IBaseFilter, public IAMFilterMiscFlags {
 public:
  Filter();
  ~Filter();

  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override;
  STDMETHODIMP_(ULONG) AddRef() override;
  STDMETHODIMP_(ULONG) Release() override;

  // IPersist
  STDMETHODIMP GetClassID(CLSID* clsid) override;

  // IMediaFilter
  STDMETHODIMP Stop() override;
  STDMETHODIMP Pause() override;
  STDMETHODIMP Run(REFERENCE_TIME start) override;
  STDMETHODIMP GetState(DWORD timeout, FILTER_STATE* state) override;
  STDMETHODIMP SetSyncSource(IReferenceClock* clock) override;
  STDMETHODIMP GetSyncSource(IReferenceClock** clock) override;

  // IBaseFilter
  STDMETHODIMP EnumPins(IEnumPins** enumerator) override;
  STDMETHODIMP FindPin(LPCWSTR id, IPin** pin) override;
  STDMETHODIMP QueryFilterInfo(FILTER_INFO* info) override;
  STDMETHODIMP JoinFilterGraph(IFilterGraph* graph, LPCWSTR name) override;
  STDMETHODIMP QueryVendorInfo(LPWSTR* vendor) override;

  // IAMFilterMiscFlags
  STDMETHODIMP_(ULONG) GetMiscFlags() override;

  Pin* pin() { return pin_; }
  IReferenceClock* clock() { return clock_; }
  FILTER_STATE state() const { return state_; }

 private:
  std::atomic<ULONG> ref_{1};
  Pin* pin_ = nullptr;
  FILTER_STATE state_ = State_Stopped;
  IReferenceClock* clock_ = nullptr;
  IFilterGraph* graph_ = nullptr;
  WCHAR name_[128] = L"Meme Cam";
  CRITICAL_SECTION lock_{};
};

/** Скільки об'єктів живе — від цього залежить, чи можна вивантажити DLL. */
extern std::atomic<long> g_object_count;

AM_MEDIA_TYPE* CreateMediaType(uint32_t width, uint32_t height, REFERENCE_TIME interval);
void FreeMediaType(AM_MEDIA_TYPE* mt);
bool IsAcceptableType(const AM_MEDIA_TYPE* mt);

}  // namespace memecam
