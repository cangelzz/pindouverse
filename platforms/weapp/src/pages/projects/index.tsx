import { useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas, Input, View, Text, ScrollView } from '@tarojs/components';
import Taro, { useDidShow, useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import type { CanvasData, ColorOverrideMap } from '@pindou/core';
import { getEffectiveHex } from '@pindou/core';
import './index.scss';

interface StoredProject {
  id: string;
  name: string;
  data: CanvasData;
  width: number;
  height: number;
  algorithm: string;
  createdAt: number;
}

const STORAGE_KEY = 'pindou:projects';

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Projects() {
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [query, setQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'time' | 'name' | 'size'>('time');

  const reload = useCallback(() => {
    try {
      const list = (Taro.getStorageSync(STORAGE_KEY) as StoredProject[]) || [];
      const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
      setProjects(sorted);
    } catch {
      setProjects([]);
    }
  }, []);

  useDidShow(() => {
    reload();
  });

  const displayed = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
    const arr = [...filtered];
    if (sortBy === 'name') {
      arr.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    } else if (sortBy === 'size') {
      arr.sort((a, b) => b.width * b.height - a.width * a.height);
    } else {
      arr.sort((a, b) => b.createdAt - a.createdAt);
    }
    return arr;
  }, [projects, query, sortBy]);

  useEffect(() => {
    if (displayed.length === 0) return;
    let overrides: ColorOverrideMap = new Map();
    try {
      const raw = Taro.getStorageSync('pindou:overrides');
      if (raw) {
        const entries = JSON.parse(raw as string) as Array<[number, { hex: string; rgb: [number, number, number] }]>;
        overrides = new Map(entries);
      }
    } catch {}
    const drawThumb = (p: StoredProject) => {
      const id = `thumb-${p.id}`;
      Taro.createSelectorQuery()
        .select(`#${id}`)
        .fields({ node: true, size: true })
        .exec((res) => {
          const item = res && res[0];
          if (!item || !item.node) return;
          const node = item.node as unknown as {
            width: number;
            height: number;
            getContext: (t: string) => CanvasRenderingContext2D;
          };
          const dpr = (Taro.getSystemInfoSync().pixelRatio as number) || 2;
          const cssW = item.width as number;
          const cssH = item.height as number;
          node.width = cssW * dpr;
          node.height = cssH * dpr;
          const ctx = node.getContext('2d');
          ctx.scale(dpr, dpr);
          ctx.fillStyle = '#fafafb';
          ctx.fillRect(0, 0, cssW, cssH);
          const cell = Math.min(cssW / p.width, cssH / p.height);
          const drawW = cell * p.width;
          const drawH = cell * p.height;
          const ox = (cssW - drawW) / 2;
          const oy = (cssH - drawH) / 2;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(ox, oy, drawW, drawH);
          for (let r = 0; r < p.height; r++) {
            for (let c = 0; c < p.width; c++) {
              const idx = p.data[r][c].colorIndex;
              if (idx !== null && idx !== undefined) {
                ctx.fillStyle = getEffectiveHex(idx, overrides);
                ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
              }
            }
          }
        });
    };
    const t = setTimeout(() => {
      displayed.forEach(drawThumb);
    }, 60);
    return () => clearTimeout(t);
  }, [displayed]);

  useShareAppMessage(() => ({
    title: '拼豆 · 一键把照片变成图纸',
    path: '/pages/home/index',
  }));

  useShareTimeline(() => ({
    title: '拼豆 · 一键把照片变成图纸',
    query: '',
  }));

  const openProject = useCallback((id: string) => {
    Taro.navigateTo({ url: `/pages/result/index?id=${id}` });
  }, []);

  const confirmDelete = useCallback(
    (project: StoredProject) => {
      Taro.showModal({
        title: '删除作品',
        content: `确认删除 "${project.name}"？此操作不可撤销。`,
        confirmText: '删除',
        confirmColor: '#ff5e62',
        success: (res) => {
          if (!res.confirm) return;
          try {
            const list = (Taro.getStorageSync(STORAGE_KEY) as StoredProject[]) || [];
            const next = list.filter((p) => p.id !== project.id);
            Taro.setStorageSync(STORAGE_KEY, next);
            reload();
            Taro.showToast({ title: '已删除', icon: 'success' });
          } catch {
            Taro.showToast({ title: '删除失败', icon: 'none' });
          }
        },
      });
    },
    [reload]
  );

  const renameProject = useCallback(
    (project: StoredProject) => {
      Taro.showModal({
        title: '重命名',
        editable: true,
        placeholderText: project.name,
        success: (res) => {
          if (!res.confirm) return;
          const name = ((res as { content?: string }).content || '').trim();
          if (!name) {
            Taro.showToast({ title: '名称不能为空', icon: 'none' });
            return;
          }
          try {
            const list = (Taro.getStorageSync(STORAGE_KEY) as StoredProject[]) || [];
            const next = list.map((p) => (p.id === project.id ? { ...p, name } : p));
            Taro.setStorageSync(STORAGE_KEY, next);
            reload();
            Taro.showToast({ title: '已重命名', icon: 'success' });
          } catch {
            Taro.showToast({ title: '重命名失败', icon: 'none' });
          }
        },
      } as Parameters<typeof Taro.showModal>[0]);
    },
    [reload]
  );

  const duplicateProject = useCallback(
    (project: StoredProject) => {
      try {
        const list = (Taro.getStorageSync(STORAGE_KEY) as StoredProject[]) || [];
        const copy: StoredProject = {
          ...project,
          id: `p_${Date.now()}`,
          name: `${project.name} 副本`,
          data: project.data.map((row) => row.map((cell) => ({ colorIndex: cell.colorIndex }))),
          createdAt: Date.now(),
        };
        Taro.setStorageSync(STORAGE_KEY, [copy, ...list]);
        reload();
        Taro.showToast({ title: '已复制', icon: 'success' });
      } catch {
        Taro.showToast({ title: '复制失败', icon: 'none' });
      }
    },
    [reload]
  );

  const openMenu = useCallback(
    (project: StoredProject) => {
      Taro.showActionSheet({
        itemList: ['打开', '重命名', '复制', '删除'],
        success: (res) => {
          if (res.tapIndex === 0) {
            Taro.navigateTo({ url: `/pages/result/index?id=${project.id}` });
          } else if (res.tapIndex === 1) {
            renameProject(project);
          } else if (res.tapIndex === 2) {
            duplicateProject(project);
          } else if (res.tapIndex === 3) {
            confirmDelete(project);
          }
        },
      });
    },
    [confirmDelete, renameProject, duplicateProject]
  );

  if (projects.length === 0) {
    return (
      <View className="projects projects--empty">
        <Text className="projects__empty">还没有作品</Text>
        <Text className="projects__hint">去"导入"页面创建你的第一个图纸</Text>
        <View
          className="projects__footer-link"
          onClick={() => Taro.navigateTo({ url: '/pages/about/index' })}
        >
          <Text className="projects__footer-link-text">关于拼豆 / 帮助</Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView className="projects" scrollY enhanced showScrollbar={false}>
      <View className="projects__header">
        <Text className="projects__title">我的作品</Text>
        <Text className="projects__count">{displayed.length}/{projects.length}</Text>
      </View>
      <View className="projects__toolbar">
        <View className="projects__search">
          <Input
            className="projects__search-input"
            value={query}
            placeholder="搜索作品名"
            confirmType="search"
            onInput={(e) => setQuery(e.detail.value)}
          />
          {query !== '' && (
            <Text className="projects__search-clear" onClick={() => setQuery('')}>
              ✕
            </Text>
          )}
        </View>
        <View className="projects__sort">
          {([
            ['time', '最新'],
            ['name', '名称'],
            ['size', '尺寸'],
          ] as Array<['time' | 'name' | 'size', string]>).map(([k, label]) => (
            <View
              key={k}
              className={`projects__sort-item${sortBy === k ? ' projects__sort-item--active' : ''}`}
              onClick={() => setSortBy(k)}
            >
              <Text className="projects__sort-text">{label}</Text>
            </View>
          ))}
        </View>
      </View>
      <View className="projects__list">
        {displayed.length === 0 && (
          <View className="projects__no-match">
            <Text className="projects__no-match-text">无匹配的作品</Text>
          </View>
        )}
        {displayed.map((p) => (
          <View
            key={p.id}
            className="projects__item"
            onClick={() => openProject(p.id)}
            onLongPress={() => openMenu(p)}
          >
            <View className="projects__item-thumb">
              <Canvas
                type="2d"
                id={`thumb-${p.id}`}
                className="projects__item-thumb-canvas"
              />
            </View>
            <View className="projects__item-main">
              <Text className="projects__item-name">{p.name}</Text>
              <View className="projects__item-meta">
                <Text className="projects__item-dim">
                  {p.width}×{p.height}
                </Text>
                <Text className="projects__item-sep">·</Text>
                <Text className="projects__item-algo">{p.algorithm}</Text>
              </View>
              <Text className="projects__item-time">{formatDate(p.createdAt)}</Text>
            </View>
            <View
              className="projects__item-delete"
              onClick={(e) => {
                e.stopPropagation();
                confirmDelete(p);
              }}
            >
              <Text className="projects__item-delete-text">删除</Text>
            </View>
          </View>
        ))}
      </View>
      <View className="projects__footer">
        <Text className="projects__footer-hint">长按作品可重命名 / 复制 / 删除</Text>
        <View
          className="projects__footer-link"
          onClick={() => Taro.navigateTo({ url: '/pages/about/index' })}
        >
          <Text className="projects__footer-link-text">关于拼豆 / 帮助</Text>
        </View>
      </View>
    </ScrollView>
  );
}
