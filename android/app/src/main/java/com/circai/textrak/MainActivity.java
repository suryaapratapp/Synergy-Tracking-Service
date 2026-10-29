package com.circai.textrak;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

/**
 * The web app runs inside this activity. The one thing it cannot do for itself is
 * ask Android for the camera at the moment a fitter taps the scan button and, if the
 * answer was "no" for good, send them to the right Settings page. This small bridge
 * ({@code window.TexTrakNative}) does both.
 */
public class MainActivity extends BridgeActivity {
    private static final int REQ_CAMERA = 4711;
    private static final String PREFS = "tex-trak";
    private static final String ASKED = "asked-camera";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(new Native(), "TexTrakNative");
    }

    private boolean cameraGranted() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED;
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private class Native {
        /** "granted", "prompt" (Android will show its dialog) or "denied" (blocked - only Settings can fix it). */
        @JavascriptInterface
        public String cameraState() {
            if (cameraGranted()) return "granted";
            boolean asked = prefs().getBoolean(ASKED, false);
            boolean canAskAgain = ActivityCompat.shouldShowRequestPermissionRationale(
                    MainActivity.this, Manifest.permission.CAMERA);
            return (asked && !canAskAgain) ? "denied" : "prompt";
        }

        /** Shows Android's own permission dialog. The answer comes back through window.__texTrakCamera(bool). */
        @JavascriptInterface
        public void requestCamera() {
            runOnUiThread(() -> {
                prefs().edit().putBoolean(ASKED, true).apply();
                ActivityCompat.requestPermissions(
                        MainActivity.this, new String[] {Manifest.permission.CAMERA}, REQ_CAMERA);
            });
        }

        /** Opens this app's page in Android Settings, where the camera can be switched on. */
        @JavascriptInterface
        public void openSettings() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.fromParts("package", getPackageName(), null));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            });
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_CAMERA) {
            final boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            getBridge().getWebView().post(() ->
                    getBridge().getWebView().evaluateJavascript(
                            "window.__texTrakCamera && window.__texTrakCamera(" + granted + ")", null));
        }
    }
}
