import { useState, useCallback, useRef } from 'react';
import { View, Text, Button, Canvas, Image, Slider } from '@tarojs/components';
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import type { CanvasData, ColorMatchAlgorithm } from '@pindou/core';
import { matchImageToMard, MARD_COLORS } from '@pindou/core';
import './index.scss';

const PRESET_SIZES = [26, 52, 78, 104];
const PREVIEW_CSS_SIZE = 320;
const PREVIEW_CANVAS_ID = 'pindouImportPreview';

type Stage = 'idle' | 'loaded' | 'processing' | 'preview';

interface PreviewState {
  data: CanvasData;
  w: number;
  h: number;
  algorithm: ColorMatchAlgorithm;
}

interface CanvasNode {
  width: number;
  height: number;
  getContext: (t: string) => CanvasRenderingContext2D;
  createImage: () => HTMLImageElement;
}

function calibrateRgb(rgb: number[], brightness: number, contrast: number, saturation: number) {
  if (brightness === 0 && contrast === 0 && saturation === 0) return;
  const c = (contrast + 100) / 100;
  const s = (saturation + 100) / 100;
  for (let i = 0; i < rgb.length; i += 3) {
    let r = rgb[i] + brightness;
    let g = rgb[i + 1] + brightness;
    let b = rgb[i + 2] + brightness;
    r = (r - 128) * c + 128;
    g = (g - 128) * c + 128;
    b = (b - 128) * c + 128;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    r = lum + (r - lum) * s;
    g = lum + (g - lum) * s;
    b = lum + (b - lum) * s;
    rgb[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    rgb[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    rgb[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}

export default function ImportPage() {
  const [stage, setStage] = useState<Stage>('idle');
  const [tempFile, setTempFile] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [maxDim, setMaxDim] = useState(52);
  const [algorithm, setAlgorithm] = useState<ColorMatchAlgorithm>('euclidean');
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const pixelRatioRef = useRef(2);

  useShareAppMessage(() => ({
    title: '拼豆 · 一键把照片变成图纸',
    path: '/pages/home/index',
  }));

  useShareTimeline(() => ({
    title: '拼豆 · 一键把照片变成图纸',
    query: '',
  }));

  const pickImage = useCallback(async () => {
    try {
      const res = await Taro.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['original'],
      });
      const file = res.tempFiles[0];
      if (!file) return;
      const info = await Taro.getImageInfo({ src: file.tempFilePath });
      setTempFile(file.tempFilePath);
      setNaturalSize({ w: info.width, h: info.height });
      setPreview(null);
      setStage('loaded');
    } catch (err) {
      if ((err as { errMsg?: string }).errMsg?.includes('cancel')) return;
      Taro.showToast({ title: '选择图片失败', icon: 'none' });
    }
  }, []);

  const drawPreview = useCallback((data: CanvasData, w: number, h: number) => {
    const query = Taro.createSelectorQuery();
    query
      .select(`#${PREVIEW_CANVAS_ID}`)
      .node()
      .exec((nodeRes) => {
        const canvasNode = nodeRes?.[0]?.node as CanvasNode | undefined;
        if (!canvasNode) return;
        const ratio = pixelRatioRef.current;
        const cellPx = Math.max(1, Math.floor(PREVIEW_CSS_SIZE / Math.max(w, h)));
        const pxW = w * cellPx;
        const pxH = h * cellPx;
        canvasNode.width = pxW * ratio;
        canvasNode.height = pxH * ratio;
        const ctx = canvasNode.getContext('2d');
        ctx.scale(ratio, ratio);
        for (let r = 0; r < h; r++) {
          for (let c = 0; c < w; c++) {
            const idx = data[r][c].colorIndex;
            ctx.fillStyle = idx !== null ? MARD_COLORS[idx].hex : '#ffffff';
            ctx.fillRect(c * cellPx, r * cellPx, cellPx, cellPx);
          }
        }
      });
  }, []);

  const generate = useCallback(async () => {
    if (!tempFile || naturalSize.w === 0 || naturalSize.h === 0) return;
    setStage('processing');
    try {
      const aspect = naturalSize.w / naturalSize.h;
      let tw: number;
      let th: number;
      if (aspect >= 1) {
        tw = maxDim;
        th = Math.max(1, Math.round(maxDim / aspect));
      } else {
        th = maxDim;
        tw = Math.max(1, Math.round(maxDim * aspect));
      }

      const offscreen = Taro.createOffscreenCanvas({
        type: '2d',
        width: tw,
        height: th,
      }) as unknown as CanvasNode;
      const ctx = offscreen.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      const image = offscreen.createImage();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('image load failed'));
        image.src = tempFile;
      });
      ctx.drawImage(image, 0, 0, tw, th);
      const imageData = ctx.getImageData(0, 0, tw, th);

      const rgb: number[] = new Array((imageData.data.length / 4) * 3);
      for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 3) {
        rgb[j] = imageData.data[i];
        rgb[j + 1] = imageData.data[i + 1];
        rgb[j + 2] = imageData.data[i + 2];
      }

      calibrateRgb(rgb, brightness, contrast, saturation);

      const indices = matchImageToMard(rgb, algorithm);
      const canvasData: CanvasData = [];
      for (let r = 0; r < th; r++) {
        const row = new Array(tw);
        for (let c = 0; c < tw; c++) {
          row[c] = { colorIndex: indices[r * tw + c] };
        }
        canvasData.push(row);
      }

      const sysInfo = Taro.getSystemInfoSync();
      pixelRatioRef.current = sysInfo.pixelRatio || 2;
      setPreview({ data: canvasData, w: tw, h: th, algorithm });
      setStage('preview');
      setTimeout(() => drawPreview(canvasData, tw, th), 30);
    } catch (err) {
      Taro.showToast({ title: '生成失败', icon: 'none' });
      setStage('loaded');
    }
  }, [tempFile, naturalSize, maxDim, algorithm, brightness, contrast, saturation, drawPreview]);

  const saveAsProject = useCallback(() => {
    if (!preview) return;
    const project = {
      id: `p_${Date.now()}`,
      name: `作品 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      data: preview.data,
      width: preview.w,
      height: preview.h,
      algorithm: preview.algorithm,
      createdAt: Date.now(),
    };
    try {
      const existing = (Taro.getStorageSync('pindou:projects') as typeof project[]) || [];
      Taro.setStorageSync('pindou:projects', [project, ...existing]);
      Taro.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => Taro.navigateTo({ url: `/pages/result/index?id=${project.id}` }), 600);
    } catch {
      Taro.showToast({ title: '保存失败', icon: 'none' });
    }
  }, [preview]);

  const reset = () => {
    setStage('idle');
    setTempFile(null);
    setNaturalSize({ w: 0, h: 0 });
    setPreview(null);
  };

  const beadCount = preview ? preview.w * preview.h : 0;

  return (
    <View className="import">
      <View className="import__header">
        <Text className="import__title">导入图片</Text>
        <Text className="import__hint">把照片转换成 MARD 拼豆图纸</Text>
      </View>

      {stage === 'idle' && (
        <View className="import__upload" onClick={pickImage}>
          <Text className="import__upload-icon">＋</Text>
          <Text className="import__upload-label">拍照 / 从相册选择</Text>
        </View>
      )}

      {(stage === 'loaded' || stage === 'processing' || stage === 'preview') && tempFile && (
        <View className="import__panel">
          <View className="import__thumb">
            <Image src={tempFile} mode="aspectFit" className="import__thumb-img" />
            <Text className="import__thumb-meta">
              原图 {naturalSize.w} × {naturalSize.h}
            </Text>
          </View>

          <View className="import__field">
            <Text className="import__field-label">长边格数</Text>
            <View className="import__chips">
              {PRESET_SIZES.map((size) => (
                <View
                  key={size}
                  className={`import__chip ${maxDim === size ? 'is-active' : ''}`}
                  onClick={() => setMaxDim(size)}
                >
                  <Text className="import__chip-text">{size}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className="import__field">
            <Text className="import__field-label">配色算法</Text>
            <View className="import__chips">
              {(
                [
                  { id: 'euclidean', label: '速度' },
                  { id: 'cielab', label: '精度' },
                ] as { id: ColorMatchAlgorithm; label: string }[]
              ).map((opt) => (
                <View
                  key={opt.id}
                  className={`import__chip ${algorithm === opt.id ? 'is-active' : ''}`}
                  onClick={() => setAlgorithm(opt.id)}
                >
                  <Text className="import__chip-text">{opt.label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className="import__field">
            <View className="import__slider-head">
              <Text className="import__field-label">色彩调整</Text>
              <Text
                className="import__slider-reset"
                onClick={() => {
                  setBrightness(0);
                  setContrast(0);
                  setSaturation(0);
                }}
              >
                重置
              </Text>
            </View>
            <View className="import__slider-row">
              <Text className="import__slider-label">亮度</Text>
              <Slider
                className="import__slider"
                min={-100}
                max={100}
                value={brightness}
                step={5}
                activeColor="#3b82f6"
                onChanging={(e) => setBrightness(e.detail.value)}
                onChange={(e) => setBrightness(e.detail.value)}
              />
              <Text className="import__slider-value">{brightness > 0 ? `+${brightness}` : brightness}</Text>
            </View>
            <View className="import__slider-row">
              <Text className="import__slider-label">对比</Text>
              <Slider
                className="import__slider"
                min={-100}
                max={100}
                value={contrast}
                step={5}
                activeColor="#3b82f6"
                onChanging={(e) => setContrast(e.detail.value)}
                onChange={(e) => setContrast(e.detail.value)}
              />
              <Text className="import__slider-value">{contrast > 0 ? `+${contrast}` : contrast}</Text>
            </View>
            <View className="import__slider-row">
              <Text className="import__slider-label">饱和</Text>
              <Slider
                className="import__slider"
                min={-100}
                max={100}
                value={saturation}
                step={5}
                activeColor="#3b82f6"
                onChanging={(e) => setSaturation(e.detail.value)}
                onChange={(e) => setSaturation(e.detail.value)}
              />
              <Text className="import__slider-value">{saturation > 0 ? `+${saturation}` : saturation}</Text>
            </View>
          </View>

          <Button
            className="import__primary"
            loading={stage === 'processing'}
            disabled={stage === 'processing'}
            onClick={generate}
          >
            {stage === 'processing' ? '生成中…' : '生成图纸'}
          </Button>

          {stage === 'preview' && preview && (
            <View className="import__result">
              <View className="import__preview">
                <Canvas
                  type="2d"
                  id={PREVIEW_CANVAS_ID}
                  canvasId={PREVIEW_CANVAS_ID}
                  className="import__preview-canvas"
                />
              </View>
              <View className="import__meta">
                <Text className="import__meta-text">
                  {preview.w} × {preview.h} · {beadCount} 颗豆
                </Text>
              </View>
              <View className="import__actions">
                <Button className="import__secondary" onClick={reset}>
                  重新选择
                </Button>
                <Button className="import__primary" onClick={saveAsProject}>
                  保存为作品
                </Button>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
