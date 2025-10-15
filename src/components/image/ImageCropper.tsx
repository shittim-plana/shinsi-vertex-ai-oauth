import { useRef, useState } from 'react';
import { Cropper, CropperRef } from 'react-advanced-cropper'; // Changed from FixedCropper
import 'react-advanced-cropper/dist/style.css';
import {
  Box,
  Button,
  Slider,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';

interface ImageCropperProps {
  imageSrc: string;
  onCropComplete?: (croppedImageUrl: string) => void;
  onCancel?: () => void;
  title?: string;
}

export default function ImageCropper({
  imageSrc,
  onCropComplete,
  onCancel,
  title = "이미지 크롭", // Default title in Korean: "Image Crop"
}: ImageCropperProps) {
  const cropperRef = useRef<CropperRef>(null); // Changed from FixedCropperRef
  const [zoom, setZoom] = useState<number>(1);
  const [isImageLoaded, setIsImageLoaded] = useState(false);

    const handleZoom = (value: number) => {
        if (cropperRef.current) {
            cropperRef.current.zoomImage(value);
        }
        setZoom(value); //keep zoom level between 0.1-3 for slider
    };

    const handleRotateLeft = () => {
        if (cropperRef.current) {
            cropperRef.current.rotateImage(-90);
        }
    };

    const handleRotateRight = () => {
        if (cropperRef.current) {
            cropperRef.current.rotateImage(90);
        }
    };

  const handleCrop = () => {
    if (cropperRef.current) {
      const croppedCanvas = cropperRef.current.getCanvas();
      if (croppedCanvas) {
        const croppedImageUrl = croppedCanvas.toDataURL('image/jpeg');
        onCropComplete?.(croppedImageUrl);
      }
    }
  };

  const handleCancel = () => {
    onCancel?.();
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ paddingInline: 2, paddingBlock: 1 }}>
        <Typography variant="h6">{title}</Typography>
        <Button onClick={handleCancel}><CloseIcon/></Button>
      </Stack>

      <Box sx={{ width: '100%', height: '500px', position: 'relative' }}>
        <Cropper // Changed from FixedCropper
          ref={cropperRef}
          src={imageSrc}
          // stencilSize prop removed to allow free-form cropping
          onReady={() => setIsImageLoaded(true)}
        />
      </Box>

      {isImageLoaded && (
        <>
          <Box>
            <Typography variant="body2" gutterBottom>Zoom</Typography>
            <Stack direction="row" spacing={2} alignItems="center" px={2}>
              <ZoomOutIcon
                sx={{ cursor: 'pointer' }}
                onClick={() => handleZoom(Math.max(zoom - 0.1, 0.1))}
              />
              <Slider
                min={0.1}
                max={3}
                step={0.1}
                value={zoom}
                onChange={(_: Event, value: number | number[]) => {
                  if (typeof value === 'number') {
                    handleZoom(value);
                  }
                }}
                sx={{ flex: 1 }}
              />
              <ZoomInIcon
                sx={{ cursor: 'pointer' }}
                onClick={() => handleZoom(Math.min(zoom + 0.1, 3))}
              />
            </Stack>
          </Box>

          <Stack direction="row" justifyContent="center" spacing={2} mt={2}>
            <Button
              variant="outlined"
              color="primary"
              onClick={handleRotateLeft}
            >
              Rotate Left
            </Button>
            <Button
              variant="outlined"
              color="primary"
              onClick={handleRotateRight}
            >
              Rotate Right
            </Button>
          </Stack>

          <Stack direction="row" justifyContent="flex-end" spacing={2} mt={2} px={2} pb={2}>
            <Button
              variant="outlined"
              color="error"
              onClick={handleCancel}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              color="primary"
              onClick={handleCrop}
            >
              Crop
            </Button>
          </Stack>
        </>
      )}
    </Box>
  );
}