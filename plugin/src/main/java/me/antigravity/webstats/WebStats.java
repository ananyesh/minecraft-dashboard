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

public class WebStats extends JavaPlugin implements Listener {

    private String databaseURL;
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private final LinkedList<String> pulseHistory = new LinkedList<>();
    private long lastTick = System.currentTimeMillis();
    private double currentTps = 20.0;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        loadConfig();
        getServer().getPluginManager().registerEvents(this, this);

        // TPS Monitor
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

        // Sync Online Players (Every 10s)
        new BukkitRunnable() {
            @Override
            public void run() {
                syncServerStats(true);
                for (Player player : Bukkit.getOnlinePlayers()) {
                    syncPlayer(player, true);
                }
            }
        }.runTaskTimerAsynchronously(this, 100L, 200L);

        // Pulse (Every 1m)
        new BukkitRunnable() {
            @Override
            public void run() {
                recordAdvancedPulse();
            }
        }.runTaskTimerAsynchronously(this, 1200L, 1200L);
    }

    @Override
    public void onDisable() {
        syncServerStats(false);
        for (Player player : Bukkit.getOnlinePlayers()) {
            syncPlayer(player, false);
        }
    }

    private void loadConfig() {
        String fullUrl = getConfig().getString("firebase-url", "");
        databaseURL = fullUrl.replace("/stats.json", "").replaceAll("/$", "");
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        // Delay sync by 3s to let SkinsRestorer finish applying the skin
        new BukkitRunnable() {
            @Override
            public void run() {
                if (player.isOnline()) {
                    syncPlayer(player, true);
                }
            }
        }.runTaskLaterAsynchronously(this, 60L);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        syncPlayer(event.getPlayer(), false);
    }

    private void syncServerStats(boolean online) {
        if (databaseURL.isEmpty() || databaseURL.contains("your-project")) return;
        double mspt = calculateMSPT();
        String json = String.format("{\"tps\":%.2f, \"mspt\":%.1f, \"players_online\":%d, \"players_max\":%d, \"status\":\"%s\"}", 
                currentTps, mspt, Bukkit.getOnlinePlayers().size(), Bukkit.getMaxPlayers(), online ? "online" : "offline");
        sendCloudUpdate(databaseURL + "/server/health.json", json, "PATCH");
    }

    private double calculateMSPT() {
        try {
            // Paper/Spigot 1.21+ MSPT check
            return (double) Bukkit.class.getMethod("getAverageTickTime").invoke(null);
        } catch (Exception e) {
            // Fallback for non-Paper servers: Estimate based on current load (crude)
            return (5.0 * (20.0 / Math.max(0.1, currentTps))); 
        }
    }

    private void recordAdvancedPulse() {
        String dp = String.format("{\"p\":%d, \"t\":%.2f, \"m\":%.1f, \"ts\":%d}", 
                Bukkit.getOnlinePlayers().size(), currentTps, calculateMSPT(), System.currentTimeMillis() / 1000);
        pulseHistory.add(dp);
        if (pulseHistory.size() > 60) pulseHistory.removeFirst();
        String json = "[" + String.join(",", pulseHistory) + "]";
        sendCloudUpdate(databaseURL + "/server/history.json", json, "PUT");
    }

    private String getSkinName(Player player) {
        try {
            if (Bukkit.getPluginManager().isPluginEnabled("SkinsRestorer")) {
                Object api = Class.forName("net.skinsrestorer.api.SkinsRestorerProvider")
                        .getMethod("get").invoke(null);
                Object playerStorage = api.getClass().getMethod("getPlayerStorage").invoke(api);
                Object optionalSkinId = playerStorage.getClass()
                        .getMethod("getSkinIdOfPlayer", java.util.UUID.class)
                        .invoke(playerStorage, player.getUniqueId());

                if (optionalSkinId == null) return player.getName();

                // Handle Optional using reflection
                try {
                    boolean isPresent = false;
                    Object isPresentResult = optionalSkinId.getClass().getMethod("isPresent").invoke(optionalSkinId);
                    if (isPresentResult instanceof Boolean) isPresent = (Boolean) isPresentResult;

                    if (isPresent) {
                        Object skinIdObj = optionalSkinId.getClass().getMethod("get").invoke(optionalSkinId);
                        if (skinIdObj != null) {
                            String skinId = skinIdObj.toString();
                            if (!skinId.isEmpty()) {
                                if (!skinId.equalsIgnoreCase(player.getName())) {
                                    getLogger().info("[WebStats Skin] " + player.getName() + " using custom skin: " + skinId);
                                }
                                return skinId;
                            }
                        }
                    }
                } catch (Exception ignored) {
                    String result = optionalSkinId.toString();
                    if (result != null && !result.equals("Optional.empty") && !result.isEmpty()) return result;
                }
            }
        } catch (Exception e) {
            String msg = (e.getMessage() != null) ? e.getMessage() : "No message";
            getLogger().warning("[WebStats Skin] SkinsRestorer API error for " + player.getName() + ": " + e.getClass().getSimpleName() + " (" + msg + ")");
        }
        return player.getName();
    }

    private void syncPlayer(Player player, boolean online) {
        if (databaseURL.isEmpty() || databaseURL.contains("your-project")) return;

        String uuid = player.getUniqueId().toString();
        String skin = getSkinName(player);
        
        int mined = 0;
        int placed = 0;
        for (Material m : Material.values()) {
            if (m.isBlock()) {
                try {
                    mined += player.getStatistic(Statistic.MINE_BLOCK, m);
                    placed += player.getStatistic(Statistic.USE_ITEM, m);
                } catch (Exception ignored) {}
            }
        }

        StringBuilder json = new StringBuilder("{");
        json.append("\"username\":\"").append(player.getName()).append("\",")
            .append("\"uuid\":\"").append(uuid).append("\",")
            .append("\"skin\":\"").append(skin).append("\",")
            .append("\"online\":").append(online).append(",")
            .append("\"stats\":{")
            .append("\"total_mined\":").append(mined).append(",")
            .append("\"total_placed\":").append(placed).append(",")
            .append("\"minecraft:custom\":{");

        boolean first = true;
        for (Statistic s : Statistic.values()) {
            if (s.getType() == Statistic.Type.UNTYPED) {
                try {
                    int val = player.getStatistic(s);
                    if (val > 0) {
                        if (!first) json.append(",");
                        json.append("\"").append(s.name()).append("\":").append(val);
                        first = false;
                    }
                } catch (Exception ignored) {}
            }
        }
        json.append("},");

        json.append("\"minecraft:mined\":{");
        first = true;
        for (Material m : Material.values()) {
            if (m.isBlock()) {
                try {
                    int val = player.getStatistic(Statistic.MINE_BLOCK, m);
                    if (val > 0) {
                        if (!first) json.append(",");
                        json.append("\"").append(m.name()).append("\":").append(val);
                        first = false;
                    }
                } catch (Exception ignored) {}
            }
        }
        json.append("},");

        json.append("\"minecraft:killed\":{");
        first = true;
        for (EntityType type : EntityType.values()) {
            if (type.isAlive()) {
                try {
                    int val = player.getStatistic(Statistic.KILL_ENTITY, type);
                    if (val > 0) {
                        if (!first) json.append(",");
                        json.append("\"").append(type.name()).append("\":").append(val);
                        first = false;
                    }
                } catch (Exception ignored) {}
            }
        }
        json.append("}}}");

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
