package me.antigravity.webstats;

import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Statistic;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedList;
import java.util.logging.Level;

public class WebStats extends JavaPlugin implements Listener {

    private String databaseURL;
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    // High-fidelity history objects
    private final LinkedList<String> pulseHistory = new LinkedList<>();

    // Manual TPS Monitoring
    private long lastTick = System.currentTimeMillis();
    private double currentTps = 20.0;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        loadConfig();

        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("WebStats enabled! QuartzSMP Theme support active.");

        // TPS Monitor Task
        new BukkitRunnable() {
            @Override
            public void run() {
                long now = System.currentTimeMillis();
                long diff = now - lastTick;
                double instantTps = 1000.0 / Math.max(diff, 1);
                currentTps = (currentTps * 0.9) + (Math.min(instantTps, 20.0) * 0.1);
                lastTick = now;
            }
        }.runTaskTimer(this, 1L, 1L);

        // Periodic Sync (Every 10s)
        new BukkitRunnable() {
            @Override
            public void run() {
                syncServerStats();
                for (Player player : Bukkit.getOnlinePlayers()) {
                    syncPlayer(player, true);
                }
            }
        }.runTaskTimerAsynchronously(this, 100L, 200L);

        // Record Pulse (Every 1 minute)
        new BukkitRunnable() {
            @Override
            public void run() {
                recordAdvancedPulse();
            }
        }.runTaskTimerAsynchronously(this, 1200L, 1200L);
    }

    private void loadConfig() {
        String fullUrl = getConfig().getString("firebase-url", "");
        databaseURL = fullUrl.replace("/stats.json", "").replaceAll("/$", "");
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        syncPlayer(event.getPlayer(), true);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        syncPlayer(event.getPlayer(), false);
    }

    private void syncServerStats() {
        if (databaseURL.isEmpty() || databaseURL.contains("your-project")) return;

        long mspt = calculateMSPT();
        String json = String.format("{\"tps\":%.2f, \"mspt\":%d, \"players_online\":%d, \"players_max\":%d}", 
                currentTps, mspt, Bukkit.getOnlinePlayers().size(), Bukkit.getMaxPlayers());

        sendCloudUpdate(databaseURL + "/server/health.json", json, "PATCH");
    }

    private long calculateMSPT() {
        try {
            return (long) Bukkit.class.getMethod("getAverageTickTime").invoke(null);
        } catch (Exception e) {
            return (long) (50.0 * (20.0 / Math.max(0.1, currentTps)));
        }
    }

    private void recordAdvancedPulse() {
        int p = Bukkit.getOnlinePlayers().size();
        double t = currentTps;
        long m = calculateMSPT();
        long ts = System.currentTimeMillis() / 1000;

        String dataPoint = String.format("{\"p\":%d, \"t\":%.2f, \"m\":%d, \"ts\":%d}", p, t, m, ts);
        pulseHistory.add(dataPoint);
        if (pulseHistory.size() > 60) pulseHistory.removeFirst();

        StringBuilder json = new StringBuilder("[");
        for (int i = 0; i < pulseHistory.size(); i++) {
            if (i > 0) json.append(",");
            json.append(pulseHistory.get(i));
        }
        json.append("]");

        sendCloudUpdate(databaseURL + "/server/history.json", json.toString(), "PUT");
    }

    private void syncPlayer(Player player, boolean online) {
        if (databaseURL.isEmpty() || databaseURL.contains("your-project")) return;

        String uuid = player.getUniqueId().toString();
        StringBuilder json = new StringBuilder("{");
        json.append("\"username\":\"").append(player.getName()).append("\",")
            .append("\"uuid\":\"").append(uuid).append("\",")
            .append("\"online\":").append(online).append(",")
            .append("\"stats\":{");

        // Custom Stats
        json.append("\"minecraft:custom\":{");
        boolean firstCustom = true;
        for (Statistic stat : Statistic.values()) {
            if (stat.getType() == Statistic.Type.UNTYPED) {
                try {
                    int val = player.getStatistic(stat);
                    if (val > 0) {
                        if (!firstCustom) json.append(",");
                        json.append("\"").append(stat.name()).append("\":").append(val);
                        firstCustom = false;
                    }
                } catch (Exception ignored) {}
            }
        }
        json.append("},");

        // Mined Blocks
        json.append("\"minecraft:mined\":{");
        boolean firstMined = true;
        for (Material mat : Material.values()) {
            if (mat.isBlock()) {
                int val = player.getStatistic(Statistic.MINE_BLOCK, mat);
                if (val > 0) {
                    if (!firstMined) json.append(",");
                    json.append("\"").append(mat.name()).append("\":").append(val);
                    firstMined = false;
                }
            }
        }
        json.append("},");

        // Mob Kills
        json.append("\"minecraft:killed\":{");
        boolean firstKilled = true;
        for (EntityType type : EntityType.values()) {
            if (type.isAlive()) {
                try {
                    int val = player.getStatistic(Statistic.KILL_ENTITY, type);
                    if (val > 0) {
                        if (!firstKilled) json.append(",");
                        json.append("\"").append(type.name()).append("\":").append(val);
                        firstKilled = false;
                    }
                } catch (Exception ignored) {}
            }
        }
        json.append("}");
        json.append("}}");

        sendCloudUpdate(databaseURL + "/players/" + uuid + ".json", json.toString(), "PATCH");
    }

    private void sendCloudUpdate(String url, String json, String method) {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Content-Type", "application/json")
                .method(method, HttpRequest.BodyPublishers.ofString(json))
                .build();
        httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString());
    }
}
