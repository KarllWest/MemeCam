// Читач черги кадрів зі спільної пам'яті.
//
// Дзеркало writer'а з src/main/virtualCamera.ts: розкладка заголовка мусить
// збігатися байт у байт, інакше фільтр читатиме сміття.
#pragma once

#include <windows.h>
#include <cstdint>

namespace memecam {

// Своя черга, окрема від OBSVirtualCamVideo — тому наша камера і камера OBS
// можуть працювати одночасно, не заважаючи одна одній.
constexpr wchar_t kMappingName[] = L"MemeCamVideo";

constexpr uint32_t kStateInvalid = 0;
constexpr uint32_t kStateStarting = 1;
constexpr uint32_t kStateReady = 2;
constexpr uint32_t kStateStopping = 3;

constexpr uint32_t kFrameCount = 3;
constexpr uint32_t kTimestampSize = 8;

// Кадр за замовчуванням, поки додаток не почав писати.
constexpr uint32_t kDefaultWidth = 1280;
constexpr uint32_t kDefaultHeight = 720;

// Інтервали між кадрами в одиницях по 100 нс. Основний режим — 60 кадрів/с,
// 30 лишаємо другим варіантом для застосунків, яким важлива менша навантага.
constexpr REFERENCE_TIME kInterval60 = 166667;
constexpr REFERENCE_TIME kInterval30 = 333333;
constexpr REFERENCE_TIME kDefaultInterval = kInterval60;

#pragma pack(push, 4)
struct QueueHeader {
  volatile uint32_t write_idx;  // 0
  volatile uint32_t read_idx;   // 4
  uint32_t state;               // 8
  uint32_t offsets[3];          // 12
  uint32_t type;                // 24
  uint32_t cx;                  // 28
  uint32_t cy;                  // 32
  uint32_t reserved0;           // 36 — вирівнювання під uint64 нижче
  uint64_t interval;            // 40
  uint32_t reserved[8];         // 48
};
#pragma pack(pop)

static_assert(sizeof(QueueHeader) == 80, "Розкладка заголовка розійшлася з writer'ом");

class QueueReader {
 public:
  ~QueueReader() { Close(); }

  /** Приєднується до черги. false означає, що додаток зараз не транслює. */
  bool Open() {
    if (header_) return true;

    handle_ = OpenFileMappingW(FILE_MAP_READ, FALSE, kMappingName);
    if (!handle_) return false;

    header_ = static_cast<QueueHeader*>(MapViewOfFile(handle_, FILE_MAP_READ, 0, 0, 0));
    if (!header_) {
      CloseHandle(handle_);
      handle_ = nullptr;
      return false;
    }
    return true;
  }

  void Close() {
    if (header_) UnmapViewOfFile(header_);
    if (handle_) CloseHandle(handle_);
    header_ = nullptr;
    handle_ = nullptr;
  }

  /** Чи є з того боку живий постачальник кадрів потрібного розміру. */
  bool IsActive(uint32_t width, uint32_t height) const {
    return header_ && header_->state == kStateReady && header_->cx == width &&
           header_->cy == height;
  }

  /**
   * Копіює найсвіжіший повністю записаний кадр.
   *
   * Беремо кадр перед поточним індексом запису: у нього writer уже дописав усе,
   * тоді як у поточний може писати просто зараз.
   */
  bool ReadLatest(uint8_t* dst, uint32_t size, uint32_t width, uint32_t height) {
    if (!IsActive(width, height)) return false;

    const uint32_t frame_size = width * height * 3 / 2;
    if (size < frame_size) return false;

    const uint32_t write_idx = header_->write_idx;
    if (write_idx >= kFrameCount) return false;
    const uint32_t idx = (write_idx + kFrameCount - 1) % kFrameCount;

    const uint32_t offset = header_->offsets[idx];
    const auto* base = reinterpret_cast<const uint8_t*>(header_);
    memcpy(dst, base + offset + kTimestampSize, frame_size);
    return true;
  }

  /** Мітка часу останнього кадру, в одиницях по 100 нс. 0 — якщо черги немає. */
  uint64_t LatestTimestamp() const {
    if (!header_ || header_->state != kStateReady) return 0;
    const uint32_t write_idx = header_->write_idx;
    if (write_idx >= kFrameCount) return 0;
    const uint32_t idx = (write_idx + kFrameCount - 1) % kFrameCount;
    const auto* base = reinterpret_cast<const uint8_t*>(header_);
    return *reinterpret_cast<const uint64_t*>(base + header_->offsets[idx]);
  }

 private:
  HANDLE handle_ = nullptr;
  QueueHeader* header_ = nullptr;
};

}  // namespace memecam
