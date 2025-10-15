'use client';
import React from 'react';
import { Box } from '@mantine/core';
import styles from './novel.module.css';

export interface NovelBackgroundLayerProps {
  imageUrl?: string | null;
  overlayOpacity?: number;
  blur?: number;
}

const NovelBackgroundLayer: React.FC<NovelBackgroundLayerProps> = ({ imageUrl, overlayOpacity, blur }) => {
  return (
    <>
      <Box
        className={styles.backgroundLayer}
        data-overlay={overlayOpacity ?? 0.6}
        data-blur={blur ?? 8}
      />
      <Box
        data-overlay={overlayOpacity ?? 0.6}
        data-blur={blur ?? 8}
      />
    </>
  );
};

export default NovelBackgroundLayer;