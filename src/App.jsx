import { useState, useEffect, useRef } from "preact/hooks";
import { listen } from '@tauri-apps/api/event';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification
} from '@tauri-apps/plugin-notification';

import { TrayIcon } from '@tauri-apps/api/tray';
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Menu } from '@tauri-apps/api/menu';

import "./App.css";

function App() {
  const [notifications, setNotifications] = useState([]);
  const [firstLoad, setFirstLoad] = useState(false);
  const [activeTab, setActiveTab] = useState("ci_activity");


  let permissionRef = useRef(false);
  const currentWindow = useRef(null);


  const notify = async (args) => {
    if (permissionRef && !permissionRef.current) {
      const permission = await requestPermission();
      permissionRef.current = permission === 'granted';
    }

    sendNotification(args)

  }

  const toggleWindow = async (currWindow, fnKey) => {
    currWindow[fnKey] ? await currWindow[fnKey]() : await Promise.reject("")
  }

  const handleTrayClick = async (itemId) => {
    if (!currentWindow.current) return;

    let visible = await currentWindow.current.isVisible();

    switch (itemId) {
      case 'toggle':
        if (visible) {
          await toggleWindow(currentWindow.current, 'hide')
        } else {
          await toggleWindow(currentWindow.current, 'show')
        }

        break;
      case 'quit':
        await toggleWindow(currentWindow.current, 'close')
        break;
      default:
        break;
    }
  };

  const initializeTray = async () => {
    try {
      const menu = await Menu.new({
        items: [
          { text: 'toggle', id: 'toggle', action: handleTrayClick },
          { text: 'quit', id: 'quit', action: handleTrayClick },
        ]
      })

      const tray = await TrayIcon.new({
        icon: await defaultWindowIcon(),
        menu,
        menuOnLeftClick: true,
      });

      currentWindow.current = getCurrentWindow()

      await currentWindow.current.hide()
      return tray

    } catch (e) {
      console.log("error: Failed to setup tray")
      console.log(e)
    }
  };

  useEffect(async () => {
    if (!currentWindow) return;

    let tray = await initializeTray();

    return async () => {
      await TrayIcon.removeById(tray.id)
    }
  }, [])


  useEffect(() => {
    const unlisten = listen("github-notification", (event) => {
      let recvdNotifications = event.payload || [];

      setFirstLoad(prevLoadState => {
        if (!prevLoadState) return true;
        return prevLoadState;
      })

      setNotifications((prevNotifications) => {
        const changedNotifications = new Set([
          ...recvdNotifications.filter(notif => prevNotifications.findIndex(n => n.id == notif.id) < 0)]);



        if (changedNotifications.size == 0) {
          return prevNotifications;
        }

        let mergedNotifications = [...prevNotifications, ...changedNotifications];
        return mergedNotifications;
      })
    });

    return () => {
      unlisten.then((unsub) => unsub());
    };
  }, []);


  useEffect(async () => {
    if (firstLoad)
      await notify({
        title: 'Yo',
        body: `There is a new github activity`,
      })

  }, [notifications])

  const groupedNotifications = {
    ci_activity: notifications.filter((n) => n.reason === "ci_activity"),
    participating: notifications.filter((n) => n.reason === "participating"),
    review_requested: notifications.filter((n) => n.reason === "review_requested"),
    rest: notifications.filter(
      (n) => !["ci_activity", "participating", "review_requested"].includes(n.reason)
    ),
  };

  const renderNotifications = (group) => {
    if (group.length === 0 && firstLoad) {
      return <p className="emptyState">No notifications in this category. 💤</p>;
    }

    if (group.length == 0 && !firstLoad) {
      return <p className="emptyState">Fetching Notifications... 🚀</p>;
    }

    return (
      <ul className="notification-list">
        {group.map((notification, index) => (
          <li key={index} className="notification-item">
            <strong>{notification.subject.title}</strong>
            <em className="repo-name">{notification.repository.full_name}</em>
          </li>
        ))}
      </ul>
    );
  };

  /*
   *<div class="row">
        <ul className="notification-list">
          {notifications.length > 0 ? (
            notifications.map((notification, index) => (
              <li key={index} className="notification-item">
                <strong>{notification.subject.title}</strong>
                <em className="repo-name">{notification.repository.full_name}</em>
              </li>
            ))
          ) : (
            <p>No notifications yet.</p>
          )}
        </ul>
      </div>
   * */

  return (
    <main className="container">
      <h1>GitHub Notifications</h1>

      <div className="tabs">
        {["ci_activity", "participating", "review_requested", "rest"].map((tab) => (
          <button
            key={tab}
            className={["tab-button", activeTab == tab ? "activeTabButton" : ""].join(" ").trim()}
            onClick={() => setActiveTab(tab)}
          >
            {tab.replace("_", " ").toUpperCase()}
          </button>
        ))}
      </div>

      {/* Notifications */}
      <div style={{ marginTop: '16px' }}>
        {renderNotifications(groupedNotifications[activeTab])}
      </div>
    </main>
  );
}

export default App;
