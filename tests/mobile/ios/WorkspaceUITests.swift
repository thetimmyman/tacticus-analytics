import XCTest

final class WorkspaceUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    func testInstalledSyntheticOfflineWriteAndProcessRelaunch() throws {
        let app = XCUIApplication(); app.launchArguments = ["--synthetic-demo"]; app.launch()
        XCTAssertTrue(app.staticTexts["workspace-mode"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["workspace-mode"].label.contains("SYNTHETIC DEMO"))
        let before = app.staticTexts["analytics"].label
        XCTAssertEqual(before, "Damage 2000 · Tokens 3 · Damage/token 666")
        app.buttons["add-raid"].tap()
        for (id, text) in [("raid-player", "Example Player"), ("raid-boss", "Example Boss"), ("raid-damage", "100"), ("raid-tokens", "1")] {
            let field = app.textFields[id]; field.tap(); field.typeText(text)
        }
        app.buttons["Save local row"].tap()
        XCTAssertTrue(app.staticTexts["workspace-status"].label.contains("Local row saved"))
        let saved = app.staticTexts["analytics"].label
        XCTAssertEqual(saved, "Damage 2100 · Tokens 4 · Damage/token 525")
        XCTAssertNotEqual(before, saved)
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts["analytics"].waitForExistence(timeout: 15))
        XCTAssertEqual(app.staticTexts["analytics"].label, saved)
        XCUIDevice.shared.press(.home); app.activate()
        XCTAssertEqual(app.staticTexts["analytics"].label, saved)
        XCTAssertEqual(app.switches["offline"].value as? String, "1")
    }
    func testInstalledCachedInventoryProgressPaginationAndRestart() throws {
        let app = XCUIApplication(); app.launchArguments = ["--synthetic-demo"]; app.launch()
        XCTAssertTrue(app.buttons["inspect-inventory"].waitForExistence(timeout: 15))
        app.buttons["inspect-inventory"].tap(); app.buttons["snapshot-items"].tap()
        XCTAssertTrue(app.staticTexts["snapshot-summary"].label.contains("52 entries"))
        app.buttons["snapshot-0"].tap()
        XCTAssertEqual(app.staticTexts["snapshot-value-amount"].label, "amount: 1")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        for _ in 0..<15 { if app.buttons["snapshot-next"].isHittable { break }; app.swipeUp() }
        app.buttons["snapshot-next"].tap(); app.buttons["snapshot-50"].tap()
        XCTAssertEqual(app.staticTexts["snapshot-value-amount"].label, "amount: 51")
        app.buttons["Close snapshot"].tap()
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["inspect-progress"].waitForExistence(timeout: 15))
        app.buttons["inspect-progress"].tap(); app.buttons["snapshot-campaigns"].tap(); app.buttons["snapshot-0"].tap()
        XCTAssertEqual(app.staticTexts["snapshot-value-name"].label, "name: Example Campaign")
        XCUIDevice.shared.press(.home); app.activate()
        XCTAssertFalse(app.staticTexts["snapshot-value-name"].exists)
        XCTAssertEqual(app.switches["offline"].value as? String, "1")
    }
    func testFreshPersonalWorkspaceRequiresPlayerAndSecureInput() throws {
        let app = XCUIApplication(); app.launch()
        XCTAssertTrue(app.buttons["connect-all"].waitForExistence(timeout: 15))
        app.buttons["add-raid"].tap()
        XCTAssertTrue(app.staticTexts["workspace-status"].label.contains("Verify Player"))
        app.switches["offline"].tap()
        app.buttons["connect-all"].tap()
        XCTAssertTrue(app.secureTextFields["secure-official-key"].waitForExistence(timeout: 5))
        app.secureTextFields["secure-official-key"].tap()
        app.secureTextFields["secure-official-key"].typeText("synthetic-ui-input")
        XCUIDevice.shared.press(.home); app.activate()
        XCTAssertFalse(app.secureTextFields["secure-official-key"].exists)
        app.buttons["connect-all"].tap()
        XCTAssertTrue(app.secureTextFields["secure-official-key"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.secureTextFields["secure-official-key"].value as? String, "")
        app.buttons["Skip"].tap()
        XCTAssertFalse(app.secureTextFields["secure-official-key"].exists)
        XCUIDevice.shared.press(.home); app.activate()
        XCTAssertTrue(app.staticTexts["analytics"].exists)
    }
}
