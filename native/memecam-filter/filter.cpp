#include "filter.h"

#include <cstring>

#include "guids.h"

namespace memecam {

std::atomic<long> g_object_count{0};

// ---------------------------------------------------------------- медіатип

AM_MEDIA_TYPE* CreateMediaType(uint32_t width, uint32_t height, REFERENCE_TIME interval) {
  auto* mt = static_cast<AM_MEDIA_TYPE*>(CoTaskMemAlloc(sizeof(AM_MEDIA_TYPE)));
  if (!mt) return nullptr;
  ZeroMemory(mt, sizeof(AM_MEDIA_TYPE));

  auto* vih = static_cast<VIDEOINFOHEADER*>(CoTaskMemAlloc(sizeof(VIDEOINFOHEADER)));
  if (!vih) {
    CoTaskMemFree(mt);
    return nullptr;
  }
  ZeroMemory(vih, sizeof(VIDEOINFOHEADER));

  const DWORD image_size = width * height * 3 / 2;

  vih->AvgTimePerFrame = interval;
  vih->dwBitRate = static_cast<DWORD>(image_size * 8 * (10000000.0 / interval));
  vih->bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  vih->bmiHeader.biWidth = static_cast<LONG>(width);
  // NV12 завжди зверху вниз, тому висота додатна.
  vih->bmiHeader.biHeight = static_cast<LONG>(height);
  vih->bmiHeader.biPlanes = 1;
  vih->bmiHeader.biBitCount = 12;
  vih->bmiHeader.biCompression = MAKEFOURCC('N', 'V', '1', '2');
  vih->bmiHeader.biSizeImage = image_size;

  mt->majortype = MEDIATYPE_Video;
  mt->subtype = kMediaSubtypeNv12;
  mt->formattype = FORMAT_VideoInfo;
  mt->bFixedSizeSamples = TRUE;
  mt->bTemporalCompression = FALSE;
  mt->lSampleSize = image_size;
  mt->cbFormat = sizeof(VIDEOINFOHEADER);
  mt->pbFormat = reinterpret_cast<BYTE*>(vih);
  return mt;
}

void FreeMediaType(AM_MEDIA_TYPE* mt) {
  if (!mt) return;
  if (mt->pbFormat) CoTaskMemFree(mt->pbFormat);
  if (mt->pUnk) mt->pUnk->Release();
  CoTaskMemFree(mt);
}

bool IsAcceptableType(const AM_MEDIA_TYPE* mt) {
  if (!mt) return false;
  if (mt->majortype != MEDIATYPE_Video) return false;
  if (mt->subtype != kMediaSubtypeNv12) return false;
  if (mt->formattype != FORMAT_VideoInfo) return false;
  if (!mt->pbFormat || mt->cbFormat < sizeof(VIDEOINFOHEADER)) return false;

  const auto* vih = reinterpret_cast<const VIDEOINFOHEADER*>(mt->pbFormat);
  // Парність обов'язкова: площина кольоровості NV12 удвічі менша по обох осях.
  if (vih->bmiHeader.biWidth % 2 || vih->bmiHeader.biHeight % 2) return false;
  return vih->bmiHeader.biWidth > 0 && vih->bmiHeader.biHeight != 0;
}

// ------------------------------------------------------------- перелічувачі

/** Перелічувач медіатипів. Тип у нас рівно один. */
class MediaTypeEnumerator : public IEnumMediaTypes {
 public:
  MediaTypeEnumerator(uint32_t width, uint32_t height, REFERENCE_TIME interval)
      : width_(width), height_(height), interval_(interval) {
    ++g_object_count;
  }
  ~MediaTypeEnumerator() { --g_object_count; }

  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_IEnumMediaTypes) {
      *ppv = static_cast<IEnumMediaTypes*>(this);
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

  STDMETHODIMP Next(ULONG count, AM_MEDIA_TYPE** types, ULONG* fetched) override {
    if (!types) return E_POINTER;
    ULONG done = 0;
    while (done < count && position_ < 1) {
      AM_MEDIA_TYPE* mt = CreateMediaType(width_, height_, interval_);
      if (!mt) break;
      types[done++] = mt;
      ++position_;
    }
    if (fetched) *fetched = done;
    return done == count ? S_OK : S_FALSE;
  }
  STDMETHODIMP Skip(ULONG count) override {
    position_ += count;
    return position_ > 1 ? S_FALSE : S_OK;
  }
  STDMETHODIMP Reset() override {
    position_ = 0;
    return S_OK;
  }
  STDMETHODIMP Clone(IEnumMediaTypes** out) override {
    if (!out) return E_POINTER;
    auto* copy = new MediaTypeEnumerator(width_, height_, interval_);
    copy->position_ = position_;
    *out = copy;
    return S_OK;
  }

 private:
  std::atomic<ULONG> ref_{1};
  ULONG position_ = 0;
  uint32_t width_;
  uint32_t height_;
  REFERENCE_TIME interval_;
};

/** Перелічувач пінів. Пін у нас рівно один. */
class PinEnumerator : public IEnumPins {
 public:
  explicit PinEnumerator(IPin* pin) : pin_(pin) {
    pin_->AddRef();
    ++g_object_count;
  }
  ~PinEnumerator() {
    pin_->Release();
    --g_object_count;
  }

  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_IEnumPins) {
      *ppv = static_cast<IEnumPins*>(this);
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

  STDMETHODIMP Next(ULONG count, IPin** pins, ULONG* fetched) override {
    if (!pins) return E_POINTER;
    ULONG done = 0;
    while (done < count && position_ < 1) {
      pin_->AddRef();
      pins[done++] = pin_;
      ++position_;
    }
    if (fetched) *fetched = done;
    return done == count ? S_OK : S_FALSE;
  }
  STDMETHODIMP Skip(ULONG count) override {
    position_ += count;
    return position_ > 1 ? S_FALSE : S_OK;
  }
  STDMETHODIMP Reset() override {
    position_ = 0;
    return S_OK;
  }
  STDMETHODIMP Clone(IEnumPins** out) override {
    if (!out) return E_POINTER;
    auto* copy = new PinEnumerator(pin_);
    copy->position_ = position_;
    *out = copy;
    return S_OK;
  }

 private:
  std::atomic<ULONG> ref_{1};
  ULONG position_ = 0;
  IPin* pin_;
};

// --------------------------------------------------------------------- пін

Pin::Pin(Filter* filter) : filter_(filter) {}

Pin::~Pin() {
  StopStreaming();
  Disconnect();
}

STDMETHODIMP Pin::QueryInterface(REFIID riid, void** ppv) {
  if (!ppv) return E_POINTER;

  if (riid == IID_IUnknown || riid == IID_IPin) {
    *ppv = static_cast<IPin*>(this);
  } else if (riid == IID_IAMStreamConfig) {
    *ppv = static_cast<IAMStreamConfig*>(this);
  } else if (riid == IID_IKsPropertySet) {
    *ppv = static_cast<IKsPropertySet*>(this);
  } else if (riid == IID_IQualityControl) {
    *ppv = static_cast<IQualityControl*>(this);
  } else {
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  AddRef();
  return S_OK;
}

STDMETHODIMP_(ULONG) Pin::AddRef() { return filter_->AddRef(); }
STDMETHODIMP_(ULONG) Pin::Release() { return filter_->Release(); }

STDMETHODIMP Pin::Connect(IPin* receive, const AM_MEDIA_TYPE* mt) {
  if (!receive) return E_POINTER;
  if (connected_) return VFW_E_ALREADY_CONNECTED;
  if (filter_->state() != State_Stopped) return VFW_E_NOT_STOPPED;

  // Якщо формат нав'язали — приймаємо лише той, який уміємо.
  AM_MEDIA_TYPE* proposed = nullptr;
  if (mt && mt->majortype != GUID_NULL) {
    if (!IsAcceptableType(mt)) return VFW_E_TYPE_NOT_ACCEPTED;
    const auto* vih = reinterpret_cast<const VIDEOINFOHEADER*>(mt->pbFormat);
    proposed = CreateMediaType(static_cast<uint32_t>(vih->bmiHeader.biWidth),
                               static_cast<uint32_t>(abs(vih->bmiHeader.biHeight)),
                               vih->AvgTimePerFrame ? vih->AvgTimePerFrame : interval_);
  } else {
    proposed = CreateMediaType(width_, height_, interval_);
  }
  if (!proposed) return E_OUTOFMEMORY;

  HRESULT hr = receive->ReceiveConnection(static_cast<IPin*>(this), proposed);
  if (FAILED(hr)) {
    FreeMediaType(proposed);
    return hr;
  }

  const auto* vih = reinterpret_cast<const VIDEOINFOHEADER*>(proposed->pbFormat);
  width_ = static_cast<uint32_t>(vih->bmiHeader.biWidth);
  height_ = static_cast<uint32_t>(abs(vih->bmiHeader.biHeight));
  interval_ = vih->AvgTimePerFrame ? vih->AvgTimePerFrame : kDefaultInterval;
  FreeMediaType(proposed);

  hr = receive->QueryInterface(IID_IMemInputPin, reinterpret_cast<void**>(&input_));
  if (FAILED(hr)) {
    receive->Disconnect();
    return hr;
  }

  // Спершу пропонуємо взяти розподільник приймача, інакше створюємо стандартний.
  if (FAILED(input_->GetAllocator(&allocator_)) || !allocator_) {
    hr = CoCreateInstance(CLSID_MemoryAllocator, nullptr, CLSCTX_INPROC_SERVER,
                          IID_IMemAllocator, reinterpret_cast<void**>(&allocator_));
    if (FAILED(hr)) {
      input_->Release();
      input_ = nullptr;
      receive->Disconnect();
      return hr;
    }
  }

  ALLOCATOR_PROPERTIES want{};
  ALLOCATOR_PROPERTIES actual{};
  want.cBuffers = 4;
  want.cbBuffer = static_cast<long>(width_ * height_ * 3 / 2);
  want.cbAlign = 1;
  want.cbPrefix = 0;

  ALLOCATOR_PROPERTIES requested{};
  if (SUCCEEDED(input_->GetAllocatorRequirements(&requested))) {
    if (requested.cbAlign > 0) want.cbAlign = requested.cbAlign;
    if (requested.cbPrefix > 0) want.cbPrefix = requested.cbPrefix;
    if (requested.cBuffers > want.cBuffers) want.cBuffers = requested.cBuffers;
  }

  hr = allocator_->SetProperties(&want, &actual);
  if (SUCCEEDED(hr)) hr = input_->NotifyAllocator(allocator_, FALSE);
  if (FAILED(hr)) {
    allocator_->Release();
    allocator_ = nullptr;
    input_->Release();
    input_ = nullptr;
    receive->Disconnect();
    return hr;
  }

  connected_ = receive;
  connected_->AddRef();
  return S_OK;
}

STDMETHODIMP Pin::ReceiveConnection(IPin*, const AM_MEDIA_TYPE*) {
  // Ми лише віддаємо кадри, приймати з'єднання нам нікуди.
  return E_UNEXPECTED;
}

STDMETHODIMP Pin::Disconnect() {
  if (filter_->state() != State_Stopped) return VFW_E_NOT_STOPPED;

  if (allocator_) {
    allocator_->Decommit();
    allocator_->Release();
    allocator_ = nullptr;
  }
  if (input_) {
    input_->Release();
    input_ = nullptr;
  }
  if (connected_) {
    connected_->Release();
    connected_ = nullptr;
  }
  return S_OK;
}

STDMETHODIMP Pin::ConnectedTo(IPin** pin) {
  if (!pin) return E_POINTER;
  *pin = connected_;
  if (!connected_) return VFW_E_NOT_CONNECTED;
  connected_->AddRef();
  return S_OK;
}

STDMETHODIMP Pin::ConnectionMediaType(AM_MEDIA_TYPE* mt) {
  if (!mt) return E_POINTER;
  if (!connected_) {
    ZeroMemory(mt, sizeof(AM_MEDIA_TYPE));
    return VFW_E_NOT_CONNECTED;
  }
  AM_MEDIA_TYPE* copy = CreateMediaType(width_, height_, interval_);
  if (!copy) return E_OUTOFMEMORY;
  *mt = *copy;
  CoTaskMemFree(copy);  // формат уже перейшов у власність викликача
  return S_OK;
}

STDMETHODIMP Pin::QueryPinInfo(PIN_INFO* info) {
  if (!info) return E_POINTER;
  info->pFilter = static_cast<IBaseFilter*>(filter_);
  filter_->AddRef();
  info->dir = PINDIR_OUTPUT;
  wcscpy_s(info->achName, L"Capture");
  return S_OK;
}

STDMETHODIMP Pin::QueryDirection(PIN_DIRECTION* dir) {
  if (!dir) return E_POINTER;
  *dir = PINDIR_OUTPUT;
  return S_OK;
}

STDMETHODIMP Pin::QueryId(LPWSTR* id) {
  if (!id) return E_POINTER;
  const wchar_t kId[] = L"Capture";
  *id = static_cast<LPWSTR>(CoTaskMemAlloc(sizeof(kId)));
  if (!*id) return E_OUTOFMEMORY;
  memcpy(*id, kId, sizeof(kId));
  return S_OK;
}

STDMETHODIMP Pin::QueryAccept(const AM_MEDIA_TYPE* mt) {
  return IsAcceptableType(mt) ? S_OK : S_FALSE;
}

STDMETHODIMP Pin::EnumMediaTypes(IEnumMediaTypes** enumerator) {
  if (!enumerator) return E_POINTER;
  *enumerator = new MediaTypeEnumerator(width_, height_, interval_);
  return S_OK;
}

STDMETHODIMP Pin::QueryInternalConnections(IPin**, ULONG* count) {
  if (count) *count = 0;
  return E_NOTIMPL;
}

STDMETHODIMP Pin::EndOfStream() { return E_UNEXPECTED; }
STDMETHODIMP Pin::BeginFlush() { return E_UNEXPECTED; }
STDMETHODIMP Pin::EndFlush() { return E_UNEXPECTED; }
STDMETHODIMP Pin::NewSegment(REFERENCE_TIME, REFERENCE_TIME, double) { return S_OK; }

// --- IAMStreamConfig ---

STDMETHODIMP Pin::SetFormat(AM_MEDIA_TYPE* mt) {
  if (!mt) return E_POINTER;
  if (!IsAcceptableType(mt)) return VFW_E_INVALIDMEDIATYPE;
  if (connected_) return VFW_E_ALREADY_CONNECTED;

  const auto* vih = reinterpret_cast<const VIDEOINFOHEADER*>(mt->pbFormat);
  width_ = static_cast<uint32_t>(vih->bmiHeader.biWidth);
  height_ = static_cast<uint32_t>(abs(vih->bmiHeader.biHeight));
  if (vih->AvgTimePerFrame) interval_ = vih->AvgTimePerFrame;
  return S_OK;
}

STDMETHODIMP Pin::GetFormat(AM_MEDIA_TYPE** mt) {
  if (!mt) return E_POINTER;
  *mt = CreateMediaType(width_, height_, interval_);
  return *mt ? S_OK : E_OUTOFMEMORY;
}

/** Режими, які пін пропонує застосункам. Перший — те, що беруть за замовчуванням. */
constexpr REFERENCE_TIME kOfferedIntervals[] = {kInterval60, kInterval30};
constexpr int kCapabilityCount =
    static_cast<int>(sizeof(kOfferedIntervals) / sizeof(kOfferedIntervals[0]));

STDMETHODIMP Pin::GetNumberOfCapabilities(int* count, int* size) {
  if (!count || !size) return E_POINTER;
  *count = kCapabilityCount;
  *size = sizeof(VIDEO_STREAM_CONFIG_CAPS);
  return S_OK;
}

STDMETHODIMP Pin::GetStreamCaps(int index, AM_MEDIA_TYPE** mt, BYTE* caps) {
  if (!mt || !caps) return E_POINTER;
  if (index < 0 || index >= kCapabilityCount) return S_FALSE;

  const REFERENCE_TIME interval = kOfferedIntervals[index];
  *mt = CreateMediaType(kDefaultWidth, kDefaultHeight, interval);
  if (!*mt) return E_OUTOFMEMORY;

  auto* c = reinterpret_cast<VIDEO_STREAM_CONFIG_CAPS*>(caps);
  ZeroMemory(c, sizeof(VIDEO_STREAM_CONFIG_CAPS));
  c->guid = FORMAT_VideoInfo;
  c->VideoStandard = AnalogVideo_None;
  c->InputSize.cx = kDefaultWidth;
  c->InputSize.cy = kDefaultHeight;
  c->MinCroppingSize = c->InputSize;
  c->MaxCroppingSize = c->InputSize;
  c->CropGranularityX = 1;
  c->CropGranularityY = 1;
  c->MinOutputSize = c->InputSize;
  c->MaxOutputSize = c->InputSize;
  c->OutputGranularityX = 1;
  c->OutputGranularityY = 1;
  // Діапазон покриває обидва режими: застосунок може попросити будь-який із них.
  c->MinFrameInterval = kInterval60;
  c->MaxFrameInterval = kInterval30;
  c->MinBitsPerSecond =
      static_cast<LONG>(kDefaultWidth * kDefaultHeight * 3 / 2 * 8 * (10000000 / kInterval30));
  c->MaxBitsPerSecond =
      static_cast<LONG>(kDefaultWidth * kDefaultHeight * 3 / 2 * 8 * (10000000 / kInterval60));
  return S_OK;
}

// --- IKsPropertySet ---

STDMETHODIMP Pin::Set(REFGUID, DWORD, void*, DWORD, void*, DWORD) { return E_NOTIMPL; }

STDMETHODIMP Pin::Get(REFGUID set, DWORD id, void*, DWORD, void* data, DWORD data_size,
                      DWORD* returned) {
  if (set != AMPROPSETID_Pin) return E_PROP_SET_UNSUPPORTED;
  if (id != AMPROPERTY_PIN_CATEGORY) return E_PROP_ID_UNSUPPORTED;
  if (data && data_size < sizeof(GUID)) return E_UNEXPECTED;

  if (returned) *returned = sizeof(GUID);
  if (!data) return S_OK;

  // Саме за цією відповіддю застосунки розуміють, що пін віддає відео з камери.
  *static_cast<GUID*>(data) = PIN_CATEGORY_CAPTURE;
  return S_OK;
}

STDMETHODIMP Pin::QuerySupported(REFGUID set, DWORD id, DWORD* support) {
  if (set != AMPROPSETID_Pin) return E_PROP_SET_UNSUPPORTED;
  if (id != AMPROPERTY_PIN_CATEGORY) return E_PROP_ID_UNSUPPORTED;
  if (support) *support = KSPROPERTY_SUPPORT_GET;
  return S_OK;
}

// --- IQualityControl ---

STDMETHODIMP Pin::Notify(IBaseFilter*, Quality) { return S_OK; }
STDMETHODIMP Pin::SetSink(IQualityControl*) { return S_OK; }

// --- потік кадрів ---

void Pin::FillBlack(uint8_t* dst, uint32_t size) const {
  const uint32_t luma = width_ * height_;
  if (size < luma * 3 / 2) return;
  // Чорний у BT.601 з обмеженим діапазоном: яскравість 16, кольоровість посередині.
  memset(dst, 16, luma);
  memset(dst + luma, 128, luma / 2);
}

HRESULT Pin::StartStreaming() {
  if (running_ || !connected_ || !allocator_) return S_OK;

  HRESULT hr = allocator_->Commit();
  if (FAILED(hr)) return hr;

  running_ = true;
  thread_ = std::thread(&Pin::ThreadProc, this);
  return S_OK;
}

void Pin::StopStreaming() {
  if (!running_) return;
  running_ = false;
  if (thread_.joinable()) thread_.join();
  if (allocator_) allocator_->Decommit();
  queue_.Close();
}

void Pin::ThreadProc() {
  const uint32_t frame_size = width_ * height_ * 3 / 2;
  REFERENCE_TIME frame_index = 0;

  // Крок таймера в мілісекундах; лишок накопичуємо, щоб не з'їхати за хвилину.
  const double step_ms = static_cast<double>(interval_) / 10000.0;
  auto next = std::chrono::steady_clock::now();

  while (running_) {
    next += std::chrono::microseconds(static_cast<long long>(step_ms * 1000.0));

    IMediaSample* sample = nullptr;
    if (FAILED(allocator_->GetBuffer(&sample, nullptr, nullptr, 0)) || !sample) {
      std::this_thread::sleep_until(next);
      continue;
    }

    BYTE* dst = nullptr;
    if (SUCCEEDED(sample->GetPointer(&dst)) && dst) {
      // Черга з'являється і зникає разом з трансляцією в додатку, тому пробуємо
      // приєднатися щокадру. Поки її немає — віддаємо чорний кадр, щоб застосунок
      // на тому кінці не думав, що камера зламалась.
      if (!queue_.IsActive(width_, height_)) queue_.Open();
      if (!queue_.ReadLatest(dst, frame_size, width_, height_)) FillBlack(dst, frame_size);

      sample->SetActualDataLength(static_cast<long>(frame_size));
      sample->SetSyncPoint(TRUE);
      sample->SetDiscontinuity(frame_index == 0);

      REFERENCE_TIME start = frame_index * interval_;
      REFERENCE_TIME stop = start + interval_;
      sample->SetTime(&start, &stop);

      if (input_) input_->Receive(sample);
    }

    sample->Release();
    ++frame_index;
    std::this_thread::sleep_until(next);
  }
}

// ------------------------------------------------------------------ фільтр

Filter::Filter() {
  InitializeCriticalSection(&lock_);
  pin_ = new Pin(this);
  ++g_object_count;
}

Filter::~Filter() {
  delete pin_;
  if (clock_) clock_->Release();
  DeleteCriticalSection(&lock_);
  --g_object_count;
}

STDMETHODIMP Filter::QueryInterface(REFIID riid, void** ppv) {
  if (!ppv) return E_POINTER;

  if (riid == IID_IUnknown || riid == IID_IBaseFilter || riid == IID_IMediaFilter ||
      riid == IID_IPersist) {
    *ppv = static_cast<IBaseFilter*>(this);
  } else if (riid == IID_IAMFilterMiscFlags) {
    *ppv = static_cast<IAMFilterMiscFlags*>(this);
  } else {
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  AddRef();
  return S_OK;
}

STDMETHODIMP_(ULONG) Filter::AddRef() { return ++ref_; }

STDMETHODIMP_(ULONG) Filter::Release() {
  const ULONG n = --ref_;
  if (n == 0) delete this;
  return n;
}

STDMETHODIMP Filter::GetClassID(CLSID* clsid) {
  if (!clsid) return E_POINTER;
  *clsid = kFilterClsid;
  return S_OK;
}

STDMETHODIMP Filter::Stop() {
  EnterCriticalSection(&lock_);
  pin_->StopStreaming();
  state_ = State_Stopped;
  LeaveCriticalSection(&lock_);
  return S_OK;
}

STDMETHODIMP Filter::Pause() {
  EnterCriticalSection(&lock_);
  // Джерело без буферизації: у паузі просто не женемо кадри.
  if (state_ == State_Running) pin_->StopStreaming();
  state_ = State_Paused;
  LeaveCriticalSection(&lock_);
  return S_OK;
}

STDMETHODIMP Filter::Run(REFERENCE_TIME) {
  EnterCriticalSection(&lock_);
  HRESULT hr = pin_->StartStreaming();
  if (SUCCEEDED(hr)) state_ = State_Running;
  LeaveCriticalSection(&lock_);
  return hr;
}

STDMETHODIMP Filter::GetState(DWORD, FILTER_STATE* state) {
  if (!state) return E_POINTER;
  *state = state_;
  return S_OK;
}

STDMETHODIMP Filter::SetSyncSource(IReferenceClock* clock) {
  EnterCriticalSection(&lock_);
  if (clock) clock->AddRef();
  if (clock_) clock_->Release();
  clock_ = clock;
  LeaveCriticalSection(&lock_);
  return S_OK;
}

STDMETHODIMP Filter::GetSyncSource(IReferenceClock** clock) {
  if (!clock) return E_POINTER;
  *clock = clock_;
  if (clock_) clock_->AddRef();
  return S_OK;
}

STDMETHODIMP Filter::EnumPins(IEnumPins** enumerator) {
  if (!enumerator) return E_POINTER;
  *enumerator = new PinEnumerator(static_cast<IPin*>(pin_));
  return S_OK;
}

STDMETHODIMP Filter::FindPin(LPCWSTR id, IPin** pin) {
  if (!pin) return E_POINTER;
  if (id && wcscmp(id, L"Capture") == 0) {
    *pin = static_cast<IPin*>(pin_);
    (*pin)->AddRef();
    return S_OK;
  }
  *pin = nullptr;
  return VFW_E_NOT_FOUND;
}

STDMETHODIMP Filter::QueryFilterInfo(FILTER_INFO* info) {
  if (!info) return E_POINTER;
  wcscpy_s(info->achName, name_);
  info->pGraph = graph_;
  if (graph_) graph_->AddRef();
  return S_OK;
}

STDMETHODIMP Filter::JoinFilterGraph(IFilterGraph* graph, LPCWSTR name) {
  // Граф навмисно не тримаємо через AddRef: це створило б цикл посилань.
  graph_ = graph;
  if (name) wcscpy_s(name_, name);
  return S_OK;
}

STDMETHODIMP Filter::QueryVendorInfo(LPWSTR* vendor) {
  if (vendor) *vendor = nullptr;
  return E_NOTIMPL;
}

STDMETHODIMP_(ULONG) Filter::GetMiscFlags() { return AM_FILTER_MISC_FLAGS_IS_SOURCE; }

}  // namespace memecam
