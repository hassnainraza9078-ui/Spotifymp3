# SONORA Music Finder — Single Top Song Player & MP3 Downloader

## 1. Prerequisites (Sirf aik baar install karein — 100% Free)
Song play karne aur MP3 download karne ke liye Windows PowerShell mein yeh 2 commands chalayein:

```powershell
winget install yt-dlp
winget install Gyan.FFmpeg
```
*(Install hone ke baad PowerShell band karke dobara open karein taake `yt-dlp` aur `ffmpeg` kaam karein.)*

## 2. Start Karne Ka Tariqa
Is folder (`Sonora-Music-Finder`) mein PowerShell open karke chalayein:

```powershell
npm start
```
Phir browser mein open karein: **http://localhost:3000**

## Kya Naya Hai
- **Sirf Aik Top Song**: Search karne par 15 results nahi, balkay sirf **1 best matching song** aata hai.
- **No YT Text**: Kahin bhi "YouTube" ya "YT" likha hua nahi aayega.
- **Instant Full Audio Player**: Song search hote hi (ya Play dabane par) neeche built-in player mein poora song chalega (duration aur seek bar ke saath).
- **Search-Style Download Bar**: Jaise upar search bar hai, bilkul waise hi clean download bar mein quality (`128k`, `192k`, `320k`) aur **`Download MP3 ↓`** button milega.
