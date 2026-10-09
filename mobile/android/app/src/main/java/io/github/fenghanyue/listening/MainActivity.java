package io.github.fenghanyue.listening;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.util.Locale;

/**
 * 沉浸式状态栏（edge-to-edge）：页面一直画到状态栏和底部手势条下面，系统只在最上层画时间 / 电量图标。
 *
 * 为什么不用 Capacitor 自带的处理（SystemBars 插件的 insetsHandling: "css"）：读了 8.5.2 的源码，它只在
 * WebView ≥ 140 时才真的铺到状态栏下面；更老的 WebView 是给整个窗口加内边距（不沉浸），注入给页面的安全区
 * 变量全是 0。国产系统自带的 WebView 经常偏旧，所以 capacitor.config.json 里把它关了（insetsHandling:
 * "disable"），这里自己做：窗口始终铺满，把状态栏 / 导航栏 / 刘海的高度注入成 CSS 变量 --safe-area-inset-*，
 * 页面统一用 var(--safe-area-inset-*, env(safe-area-inset-*, 0px)) 取值，哪个 WebView 版本都一样。
 *
 * 状态栏图标的深浅仍然交给 SystemBars.setStyle，由页面按 App 主题切换（见页面里的 syncThemeChrome）。
 */
public class MainActivity extends BridgeActivity {

    private Insets lastBars = Insets.NONE;
    private boolean lastImeVisible = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppShellPlugin.class);
        super.onCreate(savedInstanceState);

        // Android 15 起系统强制 edge-to-edge，更早的版本要自己打开。状态栏和导航栏都设成透明、配深色图标——
        // App 默认是白底主题、启动时 WebView 底色也是白底（capacitor.config.json 的 backgroundColor），
        // 页面加载后会按真正的主题再调一次。第二个参数是系统画不了深色图标时的底色：Android 8 以下导航栏
        // 图标只能是白的，透明底配白底页面会看不见，所以给它垫一层半透明黑（和 androidx 默认的深色遮罩同一个值）
        int darkScrim = Color.argb(0x80, 0x1b, 0x1b, 0x1b);
        EdgeToEdge.enable(this, SystemBarStyle.light(Color.TRANSPARENT, darkScrim), SystemBarStyle.light(Color.TRANSPARENT, darkScrim));

        View decor = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            boolean imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
            // 键盘弹出时整个页面往上收出键盘的高度，否则底部弹层里的输入框（新建歌单、导入歌单）会被键盘盖住；
            // 平时不加任何内边距，页面自己按安全区变量避让
            v.setPadding(0, 0, 0, imeVisible ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0);
            lastBars = bars;
            lastImeVisible = imeVisible;
            injectSafeArea();
            // 原样往下传：WebView ≥ 140 还会用它们填 env(safe-area-inset-*)，和注入的变量是同一组数
            return insets;
        });

        // 注入的是 <html> 上的内联样式，页面每次加载（包括刷新）完都得再注入一次
        bridge.addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageCommitVisible(WebView view, String url) {
                    injectSafeArea();
                }
            }
        );
    }

    private void injectSafeArea() {
        if (bridge == null || bridge.getWebView() == null) return;
        WebView webView = bridge.getWebView();
        float density = getResources().getDisplayMetrics().density;
        // 键盘弹出时底部已经整体收上去了，底部安全区按 0 算，免得键盘上面再空出一条导航栏的高度
        int bottom = lastImeVisible ? 0 : Math.round(lastBars.bottom / density);
        String js = String.format(
            Locale.US,
            "(function(){var s=document.documentElement.style;" +
            "s.setProperty('--safe-area-inset-top','%dpx');" +
            "s.setProperty('--safe-area-inset-right','%dpx');" +
            "s.setProperty('--safe-area-inset-bottom','%dpx');" +
            "s.setProperty('--safe-area-inset-left','%dpx');})();",
            Math.round(lastBars.top / density),
            Math.round(lastBars.right / density),
            bottom,
            Math.round(lastBars.left / density)
        );
        webView.post(() -> webView.evaluateJavascript(js, null));
    }
}
