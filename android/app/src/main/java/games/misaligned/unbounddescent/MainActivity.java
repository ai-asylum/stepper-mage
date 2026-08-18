package games.misaligned.unbounddescent;

import android.os.Bundle;
import android.view.View;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * The dungeon owns the whole screen.
 *
 * A first-person stepper played in portrait is a picture with a horizon in it, and the
 * status bar and navigation bar were cropping a band off the top and bottom of that
 * picture — on a tall phone, a tenth of the frame spent on a clock and three buttons.
 * The web build never had them, so the app looked like a worse version of the same game.
 *
 * IMMERSIVE STICKY rather than plain hide: the bars come back on a swipe from the edge
 * and then leave again on their own. Sticky matters here because both edges are live
 * surfaces — the grimoire sits against the bottom and the depth banner against the top —
 * so a mode that made the bars stay until tapped away would put system chrome over the
 * book every time a thumb strayed to the edge.
 *
 * The layout half is `setDecorFitsSystemWindows(false)`: the WebView is told to draw
 * behind the cutout and the bars, and the page handles the rest through
 * `viewport-fit=cover` and the safe-area insets the HUD already lays out inside
 * (`engine.insetTop`/`insetBottom`). Without it the bars hide but the page keeps the
 * gap they left, which is the same crop with nothing drawn in it.
 */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    WindowInsetsControllerCompat c =
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    c.setSystemBarsBehavior(
        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    c.hide(WindowInsetsCompat.Type.systemBars());
  }

  /**
   * Regaining focus re-hides them. Android hands the bars back after a permission
   * dialog, a notification shade pull, or a return from the recents switcher, and
   * without this the game runs the rest of the session with the chrome back.
   */
  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (!hasFocus) return;
    WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
        .hide(WindowInsetsCompat.Type.systemBars());
  }
}
