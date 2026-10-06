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
