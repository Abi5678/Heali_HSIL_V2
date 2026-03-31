/**
 * MedLive - Camera Module
 * Handles capturing video frames and converting them to base64 JPEG
 * for the Gemini Live API.
 */

export class CameraManager {
    constructor(videoElementId) {
        this.videoElement = document.getElementById(videoElementId);
        this.stream = null;
        this.isActive = false;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        
        // Optimize resolution for Gemini (doesn't need 4k)
        this.canvas.width = 640;
        this.canvas.height = 480;
    }

    async start() {
        if (this.isActive) return;
        try {
            // Prefer the "environment" / back camera on mobile
            this.stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
                audio: false
            });
            this.videoElement.srcObject = this.stream;
            this.isActive = true;
            return true;
        } catch (err) {
            console.error("Error accessing camera:", err);
            alert("Could not access the camera. Please check permissions.");
            return false;
        }
    }

    stop() {
        if (!this.isActive || !this.stream) return;
        this.stream.getTracks().forEach(track => track.stop());
        this.videoElement.srcObject = null;
        this.isActive = false;
    }

    captureFrameBase64() {
        if (!this.isActive) return null;
        
        // Draw current video frame to canvas
        this.ctx.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);
        
        // Get JPEG base64 string, drop the 'data:image/jpeg;base64,' prefix
        const dataUrl = this.canvas.toDataURL('image/jpeg', 0.6); // 60% quality is usually fine and smaller
        return dataUrl.split(',')[1];
    }
}
